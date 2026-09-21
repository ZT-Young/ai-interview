import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: {
    default: 'AI 模拟面试',
    template: '%s | AI 模拟面试',
  },
  description:
    '粘贴目标岗位 JD、上传简历，AI 扮演面试官完成模拟面试，生成评分报告与提升建议。',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // H5：避免 iOS 输入框自动放大
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-dvh bg-background font-sans antialiased`}>
        {children}
        {/*
          全站轻提示容器。
          `richColors` 让成功/失败使用语义色；`toastOptions.classNames` 统一圆角与阴影，
          避免与卡片视觉脱节。移动端置于底部并避开安全区。
        */}
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast: 'rounded-lg border shadow-raised text-sm',
            },
          }}
        />
      </body>
    </html>
  )
}
