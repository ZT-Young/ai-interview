/**
 * 产品身份（B 端，DATA_MODEL §2.10 / docs/design/INTERVIEWER_SIDE.md §3）。
 *
 * 放在独立模块里是因为**登录页与注册页都要用**：
 * 若让注册表单去 import 登录表单的常量，就会形成「注册依赖登录」的怪耦合，
 * 将来改登录页的 UI 会牵连注册页。
 */

/** `candidate` 求职者 / `interviewer` 面试官 */
export type Role = 'candidate' | 'interviewer'

/** 身份选项的文案与说明 —— 要让人一眼分清「我是来练的」还是「我是来看别人的」 */
export const ROLE_OPTIONS: Array<{ value: Role; label: string; hint: string }> = [
  { value: 'candidate', label: '面试者', hint: '求职者 · 练习模拟面试、查看自己的报告' },
  {
    value: 'interviewer',
    label: '面试官',
    hint: '招聘方 · 发起查看邀请、查看被授权的练习报告',
  },
]

/**
 * 登录后落到哪一侧 —— 与 `app/` 目录结构保持一致。
 *
 * 改路由时必须同步改这里，否则会出现「选了面试官却跳到求职者工作台」。
 */
export function homePathForRole(role: Role): string {
  return role === 'interviewer' ? '/interviewer' : '/'
}
