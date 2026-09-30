import Link from 'next/link'
import type { ReactNode } from 'react'

import { AppFooter } from '@/components/layout/app-header'
import { InterviewerAvatar } from '@/components/features/interview/interviewer-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { optionalUser } from '@/lib/api/guard'

/**
 * 产品落地页 `/intro`（公开）。
 *
 * 与工作台 `/` 分离：`/` 是登录后才能进入的 AI 面试工作台（未登录重定向 `/login`），
 * 本页承担「未登录访客了解产品」的职责，因此**对所有人公开**。
 *
 * 已登录用户访问时不会重复展示注册 CTA，而是引导「进入工作台」。
 */
export const metadata = {
  title: 'AI 模拟面试 · 产品介绍',
  description: '粘贴目标岗位 JD、上传简历，AI 面试官陪你练一遍，并给出多维评分与提升建议。',
}
export const dynamic = 'force-dynamic'

/* ---------------------------------------------------------------------------
 * 图标（内联 SVG，lucide 风格描边；纯装饰，currentColor 跟随文字色）
 * ------------------------------------------------------------------------- */
function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const IconSparkle = (p: { className?: string }) => (
  <Icon {...p}>
    <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
    <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
  </Icon>
)
const IconMic = (p: { className?: string }) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
  </Icon>
)
const IconChart = (p: { className?: string }) => (
  <Icon {...p}>
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <rect x="7" y="11" width="3" height="5" rx="1" />
    <rect x="13" y="7" width="3" height="9" rx="1" />
  </Icon>
)
const IconClipboard = (p: { className?: string }) => (
  <Icon {...p}>
    <rect x="6" y="4" width="12" height="17" rx="2" />
    <path d="M9 4V3h6v1" />
    <path d="M9 13l2 2 4-4" />
  </Icon>
)
const IconTrending = (p: { className?: string }) => (
  <Icon {...p}>
    <path d="M3 17l6-6 4 4 7-7" />
    <path d="M14 8h7v7" />
  </Icon>
)
const IconShield = (p: { className?: string }) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
)

const FEATURES = [
  {
    icon: IconSparkle,
    title: 'AI 面试官，随时开练',
    desc: '没有约不到的教练，没有尴尬的互相面试。想练就练，一次一个专注的对话。',
  },
  {
    icon: IconChart,
    title: '多维评分，看清强弱',
    desc: '岗位匹配、专业能力、项目深度、逻辑表达、沟通、动机，六维拆解你的表现。',
  },
  {
    icon: IconMic,
    title: '语音作答，像真面试',
    desc: '按住说话即可把语音转成文字回答，节奏更接近真实面试的压力感。',
  },
  {
    icon: IconClipboard,
    title: '参考答案，学结构',
    desc: '基于你的真实经历给出示范，告诉你怎么把一件事讲清楚、讲出亮点。',
  },
  {
    icon: IconTrending,
    title: '进度追踪，见证成长',
    desc: '每次练习都被记录，回看时能直观看到自己从哪道坎迈了过去。',
  },
  {
    icon: IconShield,
    title: '隐私合规，练得安心',
    desc: '音频只在本地服务端处理，数据最小化采集，练习内容只属于你自己。',
  },
]

const STEPS = [
  {
    no: '01',
    title: '准备材料',
    desc: '上传简历、粘贴目标岗位 JD。AI 据此生成一份专属于你的面试计划。',
  },
  {
    no: '02',
    title: 'AI 模拟面试',
    desc: '用文字或语音作答，AI 像真实面试官一样追问细节、拉回跑题。',
  },
  {
    no: '03',
    title: '看报告与建议',
    desc: '六维评分、参考答案与下一步训练计划，弱项一目了然，练得更有方向。',
  },
]

export default async function IntroPage() {
  const user = await optionalUser()

  return (
    <main className="overflow-x-hidden">
      {/* ===================== Hero ===================== */}
      <section className="relative isolate">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -left-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute -right-16 top-10 size-80 rounded-full bg-chart-2/15 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 size-64 rounded-full bg-chart-5/10 blur-3xl" />
        </div>

        <div className="container grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-12">
          <div className="space-y-6 animate-fade-in-up">
            <Badge variant="secondary" className="gap-1.5">
              <IconSparkle className="size-3.5" />
              AI 生成内容 · 仅供练习参考
            </Badge>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              像真面试一样，
              <br />
              先练一遍。
            </h1>
            <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
              粘贴目标岗位 JD、上传简历，AI 面试官会针对你的背景提问、追问，
              并在结束后给出多维评分与可执行的提升建议。把紧张，留在练习场。
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {user ? (
                <Button asChild size="lg">
                  <Link href="/">进入工作台</Link>
                </Button>
              ) : (
                <Button asChild size="lg">
                  <Link href="/register">免费开始练习</Link>
                </Button>
              )}
              <Button asChild size="lg" variant="outline">
                <Link href="/login">登录</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              不构成任何录用判断 · 数据最小化采集 · 练习内容仅你自己可见
            </p>
          </div>

          {/* Hero 旁：模拟面试卡片预览 */}
          <div className="animate-fade-in-up [animation-delay:80ms]">
            <div className="relative mx-auto w-full max-w-md rounded-2xl border bg-card/80 p-5 shadow-raised backdrop-blur">
              <div className="mb-4 flex items-center gap-3">
                <InterviewerAvatar className="size-10 text-sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">AI 面试官</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-block size-1.5 rounded-full bg-success" />
                    正在模拟 · 后端工程师
                  </p>
                </div>
                <Badge variant="outline" className="ml-auto shrink-0">
                  追问 1/2
                </Badge>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                  请介绍一次你主导过、最复杂的项目，重点说清楚你解决了什么难题。
                </div>
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    我负责了支付清结算服务，当时遇到对账差异…
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-lg bg-primary-muted/50 px-3 py-2 text-xs">
                <span className="font-medium text-accent-foreground">本场表现</span>
                <span className="flex items-center gap-1 font-semibold tabular-nums text-primary">
                  82
                  <span className="text-muted-foreground">/100</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 三步开始 ===================== */}
      <section className="container py-14 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">三步，开始一次模拟面试</h2>
          <p className="mt-3 text-muted-foreground">
            不用约人、不用排期。从准备到看到反馈，一个安静的下午就能走完。
          </p>
        </div>
        <ol className="mt-10 grid gap-5 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.no}>
              <Card className="h-full shadow-card">
                <CardHeader>
                  <span className="text-3xl font-bold tracking-tight text-primary/70">
                    {step.no}
                  </span>
                  <CardTitle className="text-lg">{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">
                    {step.desc}
                  </CardDescription>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* ===================== 特性网格 ===================== */}
      <section className="bg-muted/40 py-14 sm:py-16">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">为什么用 AI 模拟面试</h2>
            <p className="mt-3 text-muted-foreground">
              不是又一堆面试题库，而是一位随时在线的陪练，和一份看得懂的复盘。
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const FeatureIcon = feature.icon
              return (
                <div
                  key={feature.title}
                  className="group rounded-xl border bg-card p-5 shadow-card transition-colors hover:border-primary/40"
                >
                  <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <FeatureIcon className="size-5" />
                  </div>
                  <h3 className="text-base font-semibold">{feature.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {feature.desc}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ===================== 报告预览 ===================== */}
      <section className="container py-14 sm:py-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="space-y-4">
            <Badge variant="outline">一份能看懂的报告</Badge>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              不只告诉你「考得怎么样」，
              <br />
              更告诉你「下一步练什么」
            </h2>
            <p className="text-muted-foreground">
              总分之外，六维雷达让你一眼看到强弱分布；逐题反馈引用你的原话作为证据，
              参考答案只作结构示范——不替你编造经历，也不教你背稿。
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {['六维评分与雷达图', '优势与待改进点', '基于真实经历的参考答案', '自动生成的训练计划'].map(
                (item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-success/15 text-success">
                      <IconShield className="size-3" />
                    </span>
                    {item}
                  </li>
                ),
              )}
            </ul>
          </div>

          <div className="mx-auto w-full max-w-sm rounded-2xl border bg-card p-5 shadow-raised">
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-muted-foreground">面试总分</p>
              <Badge variant="outline">匹配度 72</Badge>
            </div>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-bold tabular-nums">82</span>
              <span className="text-sm text-muted-foreground">/100</span>
            </p>
            <div className="mt-4 space-y-2.5">
              {[
                { label: '专业能力', v: 4.6, c: 'bg-chart-1' },
                { label: '项目深度', v: 4.2, c: 'bg-chart-3' },
                { label: '逻辑表达', v: 3.8, c: 'bg-chart-2' },
                { label: '沟通表达', v: 4.0, c: 'bg-chart-4' },
                { label: '动机稳定', v: 4.4, c: 'bg-chart-5' },
              ].map((row) => (
                <div key={row.label} className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{row.label}</span>
                    <span className="tabular-nums">{row.v.toFixed(1)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${row.c}`}
                      style={{ width: `${(row.v / 5) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 收尾 CTA ===================== */}
      <section className="container pb-20 text-center">
        <div className="mx-auto max-w-xl rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-8 shadow-card">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            {user ? '回到工作台，继续练习' : '准备好了吗？'}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {user
              ? '你的简历、岗位 JD 与历史面试都在工作台里等着你。'
              : '注册只需一分钟，免费次数即可开始你的第一场模拟面试。'}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            {user ? (
              <Button asChild size="lg">
                <Link href="/">进入工作台</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/register">免费开始练习</Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link href="/login">已有账号，登录</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      <AppFooter />
    </main>
  )
}
