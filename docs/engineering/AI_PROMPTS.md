# AI Prompt 与 JSON Schema（V1）

> 本文档是**所有 AI 结构化输出的契约单一真源**。
> 实现位置：`lib/ai/prompts/*`（prompt 文本）与 `lib/ai/schemas/*`（zod schema）。
> 上位依据：[AGENTS.md](../../AGENTS.md) §6（AI 面试规则）、§7（合规）；字段落点见 [DATA_MODEL.md](./DATA_MODEL.md)、[ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 0. 通用约定（所有 prompt 共享）

### 0.1 统一返回信封

所有 AI 调用都必须返回：

```json
{
  "schema_version": "1.0",
  "data": { }
}
```

- `schema_version`：契约版本，写入 `evaluations.prompt_version` 或解析记录的 `extraction_meta.prompt_version`，用于审计（AGENTS.md §7 C6）。
- 校验失败时**不允许**把原始文本直接落库。

### 0.2 Schema 硬性规则

| 规则 | 说明 |
|---|---|
| `additionalProperties: false` | 模型不得自行增加字段 |
| `required` 全列 | 所有字段必须出现；未知信息用空值表达 |
| 空值规则 | 文本用 `""`；数组用 `[]`；数值未知用 `0`（`years`）或 `null`（`match_score`） |
| 数组上限 | 见各 schema；超长需截断而非报错 |

### 0.3 全局禁止项（对齐 AGENTS.md §6.1）

```text
N4 不编造：只能使用输入文本中出现的信息。禁止推断、补全、猜测。
    - 简历未写项目角色 → role 必须为 ""
    - 简历未写公司/时间 → 不得虚构
    - 技能只能来自原文出现的词，不得根据岗位"应该会什么"来补
N5 敏感信息：禁止输出或推断年龄、性别、婚育、宗教、政治面貌、民族、健康状况。
    - 简历中出现此类信息也必须忽略，不得写入任何字段
```

**后置校验**：`lib/parsing/verify.ts` 对模型输出做二次扫描（见 §7）。

---

## 1. JD 解析

**调用时机**：用户粘贴 JD 文本，或上传 JD 图片（视觉模型直读）。
**写入**：`job_jds.parsed_data`、`job_jds.title`、`job_jds.company`。

### 1.1 Prompt

```text
你是招聘信息结构化助手。请从下面的岗位 JD 中提取结构化信息。

严格遵守：
1. 只使用 JD 原文出现的信息，禁止补充、推断或美化。
2. 未提及的字段：字符串填 ""，数组填 []。
3. must_have 与 nice_to_have 必须由原文语义区分：
   - must_have：明确写"必须/要求/任职资格"或作为硬性条件陈述的项
   - nice_to_have：写"优先/加分/熟悉者优先/最好具备"的项
   若无法判断归属，放入 must_have。
4. 每条内容控制在 50 字以内，保留原文关键术语，不要改写为公司宣传语。
5. 禁止提取或推断年龄、性别、婚育、宗教、政治面貌等敏感要求；
   若 JD 中出现此类要求，忽略并不写入任何字段。
6. 只输出 JSON，不要输出解释、markdown 代码块或多余文字。

输出格式：
{schema_version, data:{title, company, must_have[], nice_to_have[], responsibilities[], keywords[]}}

JD 原文：
"""
{{jd_text}}
"""
```

> 图片输入时，`{{jd_text}}` 替换为「图片内容见附件」，图片以 `image_url` 传入同一 user 消息。

### 1.2 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "data"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["title", "company", "must_have", "nice_to_have", "responsibilities", "keywords"],
      "properties": {
        "title": { "type": "string", "maxLength": 200 },
        "company": { "type": "string", "maxLength": 200 },
        "must_have": { "type": "array", "maxItems": 20, "items": { "type": "string", "maxLength": 200 } },
        "nice_to_have": { "type": "array", "maxItems": 20, "items": { "type": "string", "maxLength": 200 } },
        "responsibilities": { "type": "array", "maxItems": 20, "items": { "type": "string", "maxLength": 200 } },
        "keywords": { "type": "array", "maxItems": 30, "items": { "type": "string", "maxLength": 50 } }
      }
    }
  }
}
```

**字段映射说明**：需求原始契约使用中文 key（"标题"/"责任"），本项目统一使用英文 snake_case 以对齐 `DATA_MODEL.md` 的列名：

| 需求契约 | 本文契约 | DB 列 |
|---|---|---|
| "标题" | `title` | `job_jds.title` |
| "公司" | `company` | `job_jds.company` |
| "must_have" | `must_have` | `parsed_data.must_have` |
| "nice_to_have" | `nice_to_have` | `parsed_data.nice_to_have` |
| "责任" | `responsibilities` | `parsed_data.responsibilities` |
| "关键词" | `keywords` | `parsed_data.keywords` |

---

## 2. 简历解析

**调用时机**：PDF / Word 抽文后，或图片（视觉模型直读）。
**写入**：`resumes.parsed_data`。

### 2.1 Prompt

```text
你是简历结构化助手。请从下面的简历文本中提取结构化信息。

严格遵守（最高优先级）：
1. **绝对禁止编造**。只能使用简历原文中出现的信息。
   - 项目未写角色/职责 → role 填 ""
   - 项目未写量化结果 → results 填 []
   - 未写教育经历 → education 填 []
   - 技能只能取自原文出现的词，不得因为"这个岗位应该会"而补充
2. 忽略并**禁止输出**年龄、性别、婚育、宗教、政治面貌、民族、健康状况、照片描述等敏感信息。
3. actions 提取候选人**做了什么**（动词开头，保留技术名词与数字）。
4. results 提取**结果与量化数据**（如"QPS 提升 40%""覆盖 300+ 用例"）。没有就不写。
5. evidence 为支撑该项目的原文片段（逐字摘录，最多 3 条），用于后续溯源。
6. 每条内容控制在 120 字以内，不得改写原意。
7. 只输出 JSON，不要输出解释或 markdown 代码块。

输出格式：
{schema_version, data:{name, years, skills[], projects[], education[], risks[]}}

- years：工作年限的整数估计；简历未提及任何时间信息时填 0。
- risks：仅记录**简历自身呈现出的、客观可验证的**疑点，
  例如"多段经历时间重叠（2021.03-2021.09）""项目描述无任何量化结果"。
  **禁止**输出主观评价、性格判断、诚信判断或录用建议。

简历文本：
"""
{{resume_text}}
"""
```

### 2.2 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "data"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "years", "skills", "projects", "education", "risks"],
      "properties": {
        "name": { "type": "string", "maxLength": 100 },
        "years": { "type": "integer", "minimum": 0, "maximum": 60 },
        "skills": { "type": "array", "maxItems": 50, "items": { "type": "string", "maxLength": 60 } },
        "projects": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["name", "role", "actions", "results", "evidence"],
            "properties": {
              "name": { "type": "string", "maxLength": 200 },
              "role": { "type": "string", "maxLength": 100 },
              "actions": { "type": "array", "maxItems": 10, "items": { "type": "string", "maxLength": 300 } },
              "results": { "type": "array", "maxItems": 10, "items": { "type": "string", "maxLength": 300 } },
              "evidence": { "type": "array", "maxItems": 3, "items": { "type": "string", "maxLength": 300 } }
            }
          }
        },
        "education": {
          "type": "array",
          "maxItems": 10,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["school", "degree", "major", "period"],
            "properties": {
              "school": { "type": "string", "maxLength": 200 },
              "degree": { "type": "string", "maxLength": 60 },
              "major": { "type": "string", "maxLength": 120 },
              "period": { "type": "string", "maxLength": 60 }
            }
          }
        },
        "risks": { "type": "array", "maxItems": 10, "items": { "type": "string", "maxLength": 200 } }
      }
    }
  }
}
```

**字段映射**：`"年份"`→`years`、`"技能"`→`skills`、`"projects"`→`projects`、`"教育"`→`education`、`"风险"`→`risks`。

### 2.3 `risks` 的合规边界（重要）

`risks` **只能**承载客观、可验证的简历陈述问题，用于提示用户完善简历。

| 允许 | 禁止 |
|---|---|
| 时间区间重叠或缺失 | 性格推断（"不够稳定"） |
| 项目描述缺少量化结果 | 诚信判断（"疑似造假"） |
| 技能与项目经历无对应 | 录用建议（"不建议录用"） |
| 经历时间线断层 | 任何敏感个人信息 |

实现层在 §7.2 做输出扫描，命中禁止项即丢弃该条。

---

## 3. 匹配分析

**调用时机**：JD 与简历都解析成功后。
**写入**：`interview_sessions.match_analysis`。

### 3.1 Prompt

```text
你是面试准备助手。请对比候选人的简历与目标岗位 JD，输出匹配分析。

严格遵守：
1. **只依据给定的 JD 与简历文本**，不引入外部行业常识作补充。
2. advantages 必须能在简历中找到对应证据（写进 evidence 字段）。
3. gaps 指 JD 要求但简历**未体现**的能力；表述为"简历中未提及 X"，而非"候选人不会 X"。
4. suggested_questions 必须基于 gaps 或 advantages 之一，
   且必须是**单个问题**（符合"一次只问一个问题"），不超过 60 字。
5. suggested_questions 禁止涉及年龄、性别、婚育、宗教、政治等敏感话题。
6. match_score 为 0-100 的整数，表示**简历与 JD 要求的匹配程度**，
   仅用于帮用户定位准备重点，**不是**对其能力的评价，也不用于任何筛选决策。
7. 只输出 JSON。

输出格式：
{schema_version, data:{match_score, advantages[], gaps[], suggested_questions[]}}

JD 结构化要求：
"""
{{jd_json}}
"""

简历结构化信息：
"""
{{resume_json}}
"""
```

### 3.2 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "data"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["match_score", "advantages", "gaps", "suggested_questions"],
      "properties": {
        "match_score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "advantages": {
          "type": "array", "maxItems": 10,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["point", "evidence"],
            "properties": {
              "point": { "type": "string", "maxLength": 200 },
              "evidence": { "type": "string", "maxLength": 300 }
            }
          }
        },
        "gaps": { "type": "array", "maxItems": 10, "items": { "type": "string", "maxLength": 200 } },
        "suggested_questions": {
          "type": "array", "maxItems": 10,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["question", "based_on"],
            "properties": {
              "question": { "type": "string", "maxLength": 120 },
              "based_on": { "type": "string", "enum": ["advantage", "gap"] }
            }
          }
        }
      }
    }
  }
}
```

**字段映射**：`"得分"`→`match_score`、`"优势"`→`advantages`、`"空档"`→`gaps`、`"suggested_questions"`→`suggested_questions`。

### 3.3 `match_score` 与六维评分的关系（必须区分）

| | `match_score`（本文） | 六维分（`evaluation` 契约，Phase 4） |
|---|---|---|
| 含义 | 简历与 JD 的**静态匹配程度** | AI 对**实际回答**的评分 |
| 取值范围 | 整数 0–100 | 六维各 0–5；总分 0–100 |
| 时机 | 面试前 | 每道题回答后 |
| 落库 | `interview_sessions.match_analysis` | `evaluations` / `reports` |
| 用途 | 帮用户定位准备重点 | 生成练习反馈 |

**两者不可互相换算**，`match_score` **不得**写入 `reports.total_score`。
总分公式仍以 [DATA_MODEL.md §5](./DATA_MODEL.md) 为唯一真源。

---

## 4. 面试计划生成（出题）

**调用时机**：JD 与简历解析完成、匹配分析产出后（`interview_sessions.match_analysis` 非空）。
**写入**：`questions` 表（每行一题）+ `interview_sessions.plan`（配额与覆盖摘要），会话状态 `draft → planned`。

### 4.1 Prompt

```text
你是面试官。请根据候选人的简历与目标岗位 JD，生成一份面试计划。

严格遵守：
1. **一次只问一个问题**：每道题必须是单个问题，不得包含多个小问。
2. **必须基于给定的 JD 与简历**：禁止编造候选人的经历、公司、数字或技能。
   - 若题目依据 JD 要求 → source = "jd"
   - 若题目依据简历中的具体经历 → source = "resume"
   - 若同时依据两者（如"用你简历中的 X 项目回答 JD 要求的 Y 能力"）→ source = "both"
   - 仅"自我介绍"与"反问环节"可以 source = "generic"
3. 题型与数量配额（总数必须为 8-12 道）：
   - self_intro 自我介绍：恰好 1 道
   - project_dig 项目深挖：3-4 道，必须指向简历中真实存在的项目
   - technical 专业题：3-4 道，必须对应 JD 中的 must_have 或职责
   - behavioral 行为题：2 道，围绕 STAR（背景/任务/行动/结果/数据）
   - reverse 反问：恰好 1 道，引导候选人向面试官提问
4. dimension 必须从以下六项中选择（用于后续评分对齐）：
   job_match(岗位匹配) / professional(专业能力) / project_depth(项目深度) /
   logic(逻辑表达) / communication(沟通表达) / motivation(动机稳定性)
5. expected_points 为该题的期望要点（2-5 条，每条 60 字内），
   用于帮候选人自查，**不得**包含对候选人的评价或录用建议。
6. follow_up_allowed：该题是否适合继续追问。
   行为题与项目深挖题通常为 true；自我介绍与反问为 false。
7. **禁止**任何涉及年龄、性别、婚育、宗教、政治的问题。
8. 只输出 JSON。

输出格式：
{schema_version, data:{questions:[{content, type, source, dimension, expected_points, follow_up_allowed}]}}

JD 结构化要求：
"""
{{jd_json}}
"""

简历结构化信息：
"""
{{resume_json}}
"""

匹配分析：
"""
{{match_json}}
"""
```

### 4.2 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "data"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["questions"],
      "properties": {
        "questions": {
          "type": "array", "minItems": 8, "maxItems": 12,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["content", "type", "source", "dimension", "expected_points", "follow_up_allowed"],
            "properties": {
              "content": { "type": "string", "maxLength": 300 },
              "type": { "enum": ["self_intro", "project_dig", "technical", "behavioral", "reverse"] },
              "source": { "enum": ["jd", "resume", "both", "generic"] },
              "dimension": {
                "enum": ["job_match", "professional", "project_depth", "logic", "communication", "motivation"]
              },
              "expected_points": {
                "type": "array", "minItems": 2, "maxItems": 5,
                "items": { "type": "string", "maxLength": 120 }
              },
              "follow_up_allowed": { "type": "boolean" }
            }
          }
        }
      }
    }
  }
}
```

### 4.3 配额与后置校验（不依赖模型自觉）

生成后由 `lib/services/plan-service.ts` 校验，任一条不满足即判失败（重试 1 次后失败）：

| 规则 | 说明 |
|---|---|
| 数量 | `8 <= questions.length <= 12` |
| 五类齐全 | 五种 `type` 必须都出现至少 1 次 |
| 配额上限 | `self_intro` 恰好 1；`reverse` 恰好 1；`project_dig` ≤ 4；`technical` ≤ 4；`behavioral` ≤ 3 |
| generic 白名单 | `source = "generic"` **仅允许** `self_intro` 与 `reverse`；出现「专业题标 generic」即判失败（防编造） |
| 可溯源 | `project_dig` / `technical` 的 `source` 不得为 `generic`（必须指向 JD 或简历） |
| 敏感问题 | 复用 `lib/parsing/verify.ts` 的敏感词扫描，命中即判失败（N5） |
| 禁止项 | 命中录用建议 / 性格与诚信判断即判失败（合规 C5） |
| 内容非空 | `content` 去空白后长度 ≥ 5 |

> **为什么用「判失败」而不是「删除该题」**：删除会破坏配额，导致题目分类失衡；
> 整体判失败并重试，能保证产出的计划始终满足配额。

### 4.4 `source` 取值说明（四值）

| 值 | 含义 | 典型题型 |
|---|---|---|
| `jd` | 依据岗位 JD 的要求/职责 | 专业题 |
| `resume` | 依据简历中的具体经历 | 项目深挖 |
| `both` | 同时依据 JD 与简历 | 项目深挖、专业题 |
| `generic` | 与个人经历无关的通用题 | **仅**自我介绍、反问 |

---

## 5. 追问与对话推进（面试编排）

**调用时机**：用户提交一次回答之后（`WAITING_ANSWER → FOLLOW_UP | NEXT_QUESTION`）。
**写入**：`interview_messages`（AI 与用户的全部消息）、`questions`（追问作为新题行，`depth > 0`）。

> 编排状态机（9 个阶段）与消息类型见 [ARCHITECTURE.md §3.6](./ARCHITECTURE.md)。

### 5.1 服务端规则优先于模型

**层数上限由服务端强制，不依赖模型自觉**：

| 规则 | 实现层 |
|---|---|
| 一次只问一个问题 | 服务端每次响应只返回 1 条消息；schema 限制追问为单条 |
| 每主问题最多 2 层追问 | **服务端**按 `root_id` 统计 `depth`；达到 2 层后强制 `NEXT_QUESTION` |
| 回答太短 → 追问细节 | **确定性阈值**（去空白后 < 30 字符）直接判 `too_short`，不调用模型 |
| 跑题 → 拉回岗位要求 | 模型判 `off_topic`，追问时注入 JD `must_have` |
| 追问基于模糊点 | 模型必须输出 `focus`（指向回答中的具体片段） |

**因此**：模型只负责「值不值得追问 + 追问什么」；「能不能再追问」永远由服务端决定。

### 5.2 Prompt

```text
你是面试官，正在进行一场模拟面试。请判断是否需要就候选人的回答继续追问。

严格遵守：
1. 若需要追问，只输出**一个**问题，不得包含多个小问。
2. 追问必须基于候选人**本次回答中出现的具体内容**（模糊、缺少细节、无量化数据之处），
   并在 focus 中逐字摘录你依据的那段回答文字。
3. 若回答已经具体充分，或追问已无必要，输出 action = "next_question"，follow_up 为 null。
4. 若回答偏离当前岗位要求，输出 reason = "off_topic"，
   追问必须把话题**拉回 JD 要求**（见下方 must_have），语气保持中立。
5. **禁止**任何涉及年龄、性别、婚育、宗教、政治的问题。
6. **禁止**编造候选人未提及的经历、公司、数字或技能。
7. 只输出 JSON。

reason 取值：
- vague      回答笼统，缺少具体做法或细节
- too_short  回答过短，信息量不足
- off_topic  回答偏离岗位要求或当前问题
- good_enough 回答充分，无需追问（此时 action 必须为 next_question）

输出格式：
{"schema_version":"1.0","data":{"action":"follow_up|next_question","follow_up":"string|null","reason":"...","focus":"string"}}

当前主问题：
"""
{{question}}
"""

简历与岗位要点（用于判断是否跑题、以及把话题拉回要求）：
"""
{{context}}
"""

用户本次回答：
"""
{{answer}}
"""
```

### 5.3 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "data"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["action", "follow_up", "reason", "focus"],
      "properties": {
        "action": { "enum": ["follow_up", "next_question"] },
        "follow_up": { "type": ["string", "null"], "maxLength": 300 },
        "reason": { "enum": ["vague", "too_short", "off_topic", "good_enough"] },
        "focus": { "type": "string", "maxLength": 300 }
      }
    }
  }
}
```

### 5.4 后置校验

| 规则 | 处理 |
|---|---|
| `action = follow_up` 但 `follow_up` 为空 | 降级为 `next_question`（不报错，避免浪费一次往返） |
| `action = next_question` 但 `follow_up` 非空 | 丢弃 `follow_up` |
| 追问内容命中敏感词 / 禁止项 | 整体判失败，重试 1 次后降级为 `next_question` |
| 服务端判定已到 2 层 | **忽略模型结果**，强制 `next_question` |
| 服务端判定 `too_short` | 不调用模型，直接按 `too_short` 生成追问 |

### 5.5 提示（hint）

用户可请求提示。提示**不给答案**，只给出回答思路。

```text
你是面试教练。候选人请求针对当前问题的提示。请给出回答思路，不要给出完整答案。

严格遵守：
1. 只给**结构与方向**（例如「可以从背景、你负责的部分、量化结果三块组织」），
   不得替候选人编造具体经历、数字或结论。
2. 不超过 120 字。
3. 禁止涉及年龄、性别、婚育、宗教、政治。
4. 只输出 JSON。

输出格式：{"schema_version":"1.0","data":{"hint":"string"}}

当前问题：
"""
{{question}}
"""

该题期望要点：
"""
{{expected_points}}
"""
```

对应的 schema：`data.hint` 为 `string`（`maxLength: 200`，`required`）。

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "data"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["hint"],
      "properties": { "hint": { "type": "string", "maxLength": 200 } }
    }
  }
}
```

---

## 6. 逐题评分（Evaluation）

**调用时机**：面试进行中每题回答后，或面试结束后批量评分。
**写入**：`evaluations`（**一题一行**，`question_id` 唯一）。

> 逐题数据落 `evaluations`，报告聚合数据落 `reports` —— 见 [DATA_MODEL.md §3.7/§3.8](./DATA_MODEL.md)。
> 两层分工不可混淆：**证据引用挂在逐题评分上**，因为只有逐题才能对应到具体回答。

### 6.1 硬性规则

| 规则 | 来源 |
|---|---|
| 六维各 0–5，必须为整数 | AGENTS.md §6.2 |
| **每条评分必须引用回答原文证据**，至少 1 条 | AGENTS.md §6.1 N6 |
| 证据必须是**回答原文的子串**（校验层强制） | 本节 §6.4 |
| 低分（任一维 < 3）必须给出可执行改进建议 | 任务要求 |
| 参考回答**只能基于候选人真实经历**，不得编造项目/数字 | AGENTS.md §6.1 N4 |
| 禁止敏感信息与录用建议 | AGENTS.md §7 C5 |

### 6.2 Prompt

```text
你是面试评估助手。请针对候选人的一次回答，按六个维度打分并给出反馈。

六个维度（每项 0-5 的整数）：
- job_match      岗位匹配：回答是否回应了岗位要求
- professional   专业能力：技术判断与知识准确性
- project_depth  项目深度：是否讲清背景、做法与取舍
- logic          逻辑表达：结构是否清晰、有无因果
- communication  沟通表达：表述是否简洁易懂
- motivation     动机稳定性：是否体现持续投入与目标感

评分必须遵守（最高优先级）：
1. **每条评分都要引用回答原文证据**：evidence_quotes 至少 1 条，
   每条必须是从回答中**逐字复制的片段**（不得改写、不得拼接、不得编造）。
2. **禁止编造候选人未提及的经历、公司、数字或技能**。
3. 回答为空或明显未作答时，六维均给 0，并在 feedback 中说明原因。
4. 任一维度低于 3 分时，feedback 必须包含**可执行的改进建议**
   （例如"补充量化结果""说明技术选型的取舍依据"），不得只写"回答不好"。
5. better_answer 为**改进要点**：指出应补充哪些信息、按什么结构组织。
6. reference_answer 为**参考答案**：给出一段候选人下次可以照着说的示范回答。
   这是本题最重要的产出，请认真写：
   - **只能使用候选人简历与本次回答中出现的真实经历、技能、项目**；
     简历里没有的经历一律不得出现。
   - 按 **STAR** 组织：背景(S) → 任务(T) → 行动(A) → 结果(R)。
   - **贴合岗位要求**：优先呼应岗位的硬性要求与职责。
   - 用第一人称、口语化，像真人在面试里说话。
   - **凡是你无法从简历中确定的具体信息（数字、指标、时间、规模、技术细节），
     必须写成占位符** `【待补充：需要填写的内容】`，**绝不允许编造具体数字或事实**。
   - 结尾提示候选人把【】换成自己的真实数据。
   - 长度 150-400 字。"反问环节"等题型给出提问思路即可。
7. **禁止**输出年龄、性别、婚育、宗教、政治等敏感内容，**禁止**给出录用建议或性格评价。
8. 只输出 JSON。

输出格式：
{"schema_version":"1.0","data":{
  "dimension_scores":{"job_match":0,"professional":0,"project_depth":0,"logic":0,"communication":0,"motivation":0},
  "evidence_quotes":[{"quote":"逐字摘录的回答片段","reason":"该证据支撑了什么判断"}],
  "feedback":"string，具体反馈（低分时含可执行建议）",
  "better_answer":"string，改进要点",
  "reference_answer":"string，参考答案（示范怎么答）"
}}

> **`better_answer` 与 `reference_answer` 的区别**（不要混淆）：
> | 字段 | 回答的问题 | 落库位置 |
> |---|---|---|
> | `better_answer` | 「你缺什么信息、该怎么补」 | 并入 `evaluations.feedback` |
> | `reference_answer` | 「这题可以这样答」的完整示范 | `evaluations.reference_answer` |
>
> 因 `reference_answer` 需要候选人真实经历作为素材，评分 prompt **必须同时传入
> `resume_json`**；未关联简历时要明确告知模型「只给答题思路，不要编造经历」。

岗位要求：
"""
{{jd_json}}
"""

题目：{{question}}
题型：{{question_type}}
该题期望要点：
"""
{{expected_points}}
"""

候选人简历（参考答案**只能**基于这里出现的真实经历）：
"""
{{resume_json}}
"""

候选人本次回答：
"""
{{answer}}
"""
```

### 6.3 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "data"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["dimension_scores", "evidence_quotes", "feedback", "better_answer", "reference_answer"],
      "properties": {
        "dimension_scores": {
          "type": "object",
          "additionalProperties": false,
          "required": ["job_match", "professional", "project_depth", "logic", "communication", "motivation"],
          "properties": {
            "job_match": { "type": "integer", "minimum": 0, "maximum": 5 },
            "professional": { "type": "integer", "minimum": 0, "maximum": 5 },
            "project_depth": { "type": "integer", "minimum": 0, "maximum": 5 },
            "logic": { "type": "integer", "minimum": 0, "maximum": 5 },
            "communication": { "type": "integer", "minimum": 0, "maximum": 5 },
            "motivation": { "type": "integer", "minimum": 0, "maximum": 5 }
          }
        },
        "evidence_quotes": {
          "type": "array", "minItems": 1, "maxItems": 5,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["quote", "reason"],
            "properties": {
              "quote": { "type": "string", "maxLength": 300 },
              "reason": { "type": "string", "maxLength": 200 }
            }
          }
        },
        "feedback": { "type": "string", "maxLength": 800 },
        "better_answer": { "type": "string", "maxLength": 800 },
        "reference_answer": { "type": "string", "maxLength": 1200 }
      }
    }
  }
}
```

### 6.4 后置校验（`lib/services/evaluation-service.ts`）

| 规则 | 处理 |
|---|---|
| `evidence_quotes` 为空 | 判失败（重试 1 次后放弃） |
| `quote` 归一化后**不是回答原文子串** | **剔除该条**；全部被剔除则判失败（防止模型编造引用） |
| 任一维度 < 3 但 `feedback` 无动词性建议 | 附加通用建议，并在 `metadata.adjusted` 标记 |
| `feedback` / `better_answer` 命中敏感词或禁止项 | 判失败并重试 |
| `reference_answer` 为空或仅空白 | 落库为 `null`（不阻塞评分，前端不渲染该区块） |
| 六维分数非整数或越界 | schema 校验失败 |

> **归一化**：比较前去除空白与大小写差异，避免因排版差异误杀真实引用。

> ⚠️ **禁止词表必须精确，否则会误杀正当内容**：`PROHIBITED_PATTERNS` 是**拒绝**过滤器，
> 误杀的后果是整份面试计划生成失败（用户只看到 502「生成面试计划失败」）。
> 实测踩过的误杀：`稳定性` 曾被整词判为「性格判断」，而真实模型产出的
> 「请讲一次你负责排查线上性能或**稳定性**问题的经历」是**完全正当的技术题**
> ——JD 职责里就写着「稳定性保障」，第六个评分维度也叫「动机稳定性」。
> 现只拦明确的负面判断（`稳定性差`/`不稳定`）。
> **修改该表时必须补「不得误杀正当内容」的回归测试**（见 `tests/unit/parse-verify.test.ts`）。

---

## 7. 报告生成（Report）

**调用时机**：面试 `phase = FINISHED` 之后。
**写入**：`reports`（一场面试一份，`session_id` 唯一）+ 会话 `phase → REPORTING`。

### 7.1 分数计算（不交给模型）

**总分与六维汇总由服务端按公式计算**（[DATA_MODEL.md §5](./DATA_MODEL.md) 为唯一真源），
模型**只负责**文字部分（优势、问题、参考回答、下一步建议）与 `resume_risks` 归纳。

```
dimension_score(d) = mean(该会话所有 evaluations 的 d 维得分)     # 0–5，保留 1 位小数
total_score        = (Σ 六维 dimension_score / 30) × 100          # 0–100，保留 1 位小数
```

**为什么不交给模型算**：六维等权时总分等价于各题折算分的均值，
由服务端计算可保证**分数与逐题证据严格可回溯**（AGENTS.md §5 建模要求）。

### 7.2 Prompt

```text
你是面试复盘助手。基于本次面试的逐题评分结果，撰写一份复盘报告。

严格遵守：
1. **只依据给定的逐题评分与简历信息**，禁止编造候选人未提及的经历、公司、数字或技能。
2. highlights（优势）每条都应能在逐题评分中找到依据。
3. issues（问题）指可改进之处，表述为"下次可以……"，**不得**做性格评价或录用判断。
4. reference_answers（参考回答）为**改进要点**，基于候选人真实经历指出应如何组织与补充；
   **不得编造具体项目、数字或结论**。
5. next_actions（下一步建议）必须**可执行**（例如"补充 1 个可量化的项目结果"），
   而不是"多练习"这类空话。
6. resume_risks 从给定的简历疑点中归纳，**不得新增**简历中不存在的疑点。
7. **禁止**输出年龄、性别、婚育、宗教、政治等敏感内容，**禁止**给出录用建议。
8. 只输出 JSON。

输出格式：
{"schema_version":"1.0","data":{
  "summary":"string，总评（200 字内）",
  "highlights":["string"],
  "issues":["string"],
  "reference_answers":[{"question":"原问题","improvement":"改进要点"}],
  "next_actions":["string"],
  "resume_risks":["string"]
}}

逐题评分结果：
"""
{{evaluations_json}}
"""

简历疑点（来自简历解析，仅可归纳不得新增）：
"""
{{resume_risks}}
"""

岗位要求：
"""
{{jd_json}}
"""
```

### 7.3 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "data"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["summary", "highlights", "issues", "reference_answers", "next_actions", "resume_risks"],
      "properties": {
        "summary": { "type": "string", "maxLength": 500 },
        "highlights": { "type": "array", "maxItems": 8, "items": { "type": "string", "maxLength": 200 } },
        "issues": { "type": "array", "maxItems": 8, "items": { "type": "string", "maxLength": 200 } },
        "reference_answers": {
          "type": "array", "maxItems": 12,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["question", "improvement"],
            "properties": {
              "question": { "type": "string", "maxLength": 300 },
              "improvement": { "type": "string", "maxLength": 300 }
            }
          }
        },
        "next_actions": { "type": "array", "maxItems": 8, "items": { "type": "string", "maxLength": 200 } },
        "resume_risks": { "type": "array", "maxItems": 10, "items": { "type": "string", "maxLength": 200 } }
      }
    }
  }
}
```

### 7.4 字段映射（需求契约 → 落库）

| 需求 JSON | 本文契约 | DB 列 |
|---|---|---|
| `overall_score` | `total_score`（服务端计算） | `reports.total_score` |
| `dimensions[]` | `dimension_scores`（服务端计算） | `reports.dimension_scores` |
| `questions[]` | 拆到 `evaluations` 表 | `evaluations.*` |
| `"优势"` | `highlights` | `reports.highlights` |
| `problems`（逐题） | 并入 `evaluations.feedback` | `evaluations.feedback` |
| `better_answer`（逐题） | 并入 `evaluations.feedback` 的改进要点 | `evaluations.feedback` |
| **`reference_answer`（逐题）** | **独立字段**（不是改进要点，是「示范怎么答」） | `evaluations.reference_answer`（迁移 0007 新增） |
| `resume_risks` | `resume_risks` | `reports.resume_risks`（迁移 0005 新增） |
| `next_actions` | `next_actions` | `reports.next_steps` |
| — | `issues` | `reports.issues` |
| — | `reference_answers`（**改进要点**，全局） | `reports.reference_answers` |

> **`reference_answers`（报告级）与 `reference_answer`（逐题）不是一回事**：
> 前者是报告顶部的「改进要点」列表（`question` + `improvement`），
> 后者是逐题反馈里的**完整参考答案示范**。命名相近但语义、落库位置都不同，
> 阅读代码时注意区分。

> **注意**：`dimensions[].evidence` 在需求契约中挂在维度上，但**维度分是聚合值**，
> 无法对应到单条回答；因此证据统一落在 `evaluations.evidence_quotes`（逐题）。

### 7.5 后置校验

| 规则 | 处理 |
|---|---|
| `highlights` / `issues` / `next_actions` 出现敏感词或录用建议 | 剔除该条 |
| `reference_answers[].question` 不在本次面试题目中 | 剔除（防虚构题目） |
| `resume_risks` 不在简历解析的 risks 中 | 剔除（防新增疑点） |
| 全部字段为空 | 判失败并重试 |

---

## 8. 解析状态与失败契约

### 8.1 `parse_status` 状态

```text
pending ──► processing ──► success
                    └────► failed
```

| 状态 | 含义 | 前端行为 |
|---|---|---|
| `pending` | 已创建记录，尚未解析 | 展示「等待解析」 |
| `processing` | 解析中 | 展示进度，禁用编辑 |
| `success` | 结构化成功且通过 schema 校验 | 展示结构化结果，可编辑 |
| `failed` | 抽取或校验失败 | **展示错误提示 + 允许手动填写/修改** |

### 8.2 `extraction_meta`（`resumes` / `job_jds` 的 jsonb 列）

```json
{
  "source": "pdf | docx | doc | image | text",
  "text_length": 0,
  "page_count": 0,
  "vision_used": false,
  "low_confidence_fields": ["projects[0].role"],
  "prompt_version": "1.0",
  "attempts": 1,
  "truncated": false
}
```

- `low_confidence_fields`：图片识别 / 文本残缺时模型自报的不确定字段，前端**高亮提示用户核对**。
- `truncated`：原文超出模型上下文上限被截断（避免用户误以为解析完整）。

### 8.3 失败时的用户可见信息

`parse_error` 为面向用户的中文提示，禁止输出供应商原始报错。约定取值：

| 场景 | `parse_error` |
|---|---|
| 不支持的文件类型 | 暂不支持该文件格式，请上传 PDF、Word 或图片 |
| 文件损坏/加密 | 文件无法读取，可能已损坏或加密，请重新导出后上传 |
| 扫描件无文字层 | 未能从文件中识别出文字，请上传更清晰的图片 |
| 文本过短 | 内容过短，无法提取有效信息，请补充后重试 |
| AI 返回不合规 | 解析结果格式异常，已保留原文，请手动填写要点 |
| AI 服务不可用 | 解析服务暂时不可用，请稍后重试或手动填写 |

**关键要求**：无论何种失败，**原始文本与文件都必须保留**，用户可以手动填写（AGENTS.md §2 第 4 步的硬要求）。

---

## 9. 输出后置校验

`lib/parsing/verify.ts` 在 schema 校验之后执行，不依赖模型自觉。

### 9.1 通用

1. **Schema 校验**（zod，`strict()`）：失败则重试 1 次，仍失败 → 判失败。
2. **空内容检测**：`data` 全为空值（如 `name=""`、`skills=[]`、`projects=[]`）→ 视为解析失败。
3. **原文一致性**：`skills` / `projects[].name` 等关键字段需在原文中出现（忽略大小写与空白），否则剔除该项。

### 9.2 敏感内容过滤（N5）

对全部字符串字段做关键词扫描，命中即**丢弃该条**并记入 `extraction_meta`（解析）或判失败（出题）：

```text
年龄/出生年月/生日/性别/男/女/已婚/未婚/离异/婚姻/结婚/婚育
生育/已育/未育/孕/子女/宗教/信仰/政治面貌/党员/团员/党派
民族/籍贯/户口/老家/身份证/护照号/证件号/身高/体重/健康状况/病史/残疾
```

> 注意：`risks` 中允许出现「时间重叠」等客观表述，因此过滤只针对敏感人物属性，不针对时间。

### 9.3 禁止项过滤（N4 + 合规 C5）

以下模式命中即丢弃（解析）或判失败（出题）：

- 录用建议：`建议录用` / `不建议录用` / `不予录用` / `淘汰` / `pass 掉` / `不适合该岗位` / `不予考虑`
- 性格与诚信判断：`性格` / `稳定性` / `不稳定` / `诚信` / `造假` / `可疑` / `说谎` / `不诚实`

### 9.4 失败降级顺序

```text
1 次重试（同 prompt，temperature 降为 0.2）
  ↓ 仍失败
parse_status = failed，保留 raw_text 与 extraction_meta
  ↓
前端提示 parse_error，并要求用户手动填写
```

---

## 10. 与其他文档的接口

| 消费方 | 使用内容 |
|---|---|
| `lib/ai/schemas/*` | 本文 §1.2 / §2.2 / §3.2 / §4.2 / §5.3 / §6.3 / §7.3 的 zod 等价实现 |
| `lib/parsing/verify.ts` | §9 的后置校验规则 |
| `lib/services/plan-service.ts` | §4.3 的配额与后置校验规则 |
| `lib/services/orchestration-service.ts` | §5.1 的服务端规则（层数上限、太短阈值） |
| `lib/services/evaluation-service.ts` | §6.4 的证据引用校验 |
| `lib/services/report-service.ts` | §7.1 的分数公式（服务端计算） |
| `db/schema/*` | `parsed_data`、`questions.*`、`interview_messages.*`、`evaluations.*`、`reports.*` |
| `docs/design/UI.md` | 报告页展示（免费/付费字段裁剪） |

> **已全部落地**：JD 解析（§1）、简历解析（§2）、匹配分析（§3）、出题（§4）、
> 追问与提示（§5）、逐题评分（§6）、报告生成（§7）。
> 至此 V1 的 AI 契约全部定义完毕，`evaluations.*` 与 `reports.*` 不再是「不稳定契约」。
