import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useTranslation } from 'react-i18next'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const ToastProvider = ToastPrimitives.Provider

/** Toast viewport — floats at the bottom-center of the app window */
const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      // Position: bottom-center of the app window
      // We use left-1/2 + -translate-x-1/2 to perfectly centre horizontally
      'fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999]',
      'flex flex-col-reverse gap-2 w-auto max-w-sm pointer-events-none',
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Root
    ref={ref}
    className={cn(
      // Base layout
      'group pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden',
      'rounded-xl border px-4 py-3 shadow-xl shadow-black/20',
      // Glassmorphism — matches the rest of the app
      'bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl',
      'border-white/60 dark:border-white/10',
      'text-gray-900 dark:text-gray-100',
      // Slide-in from bottom, slide-out to bottom
      'transition-all duration-200',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-4',
      'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
      'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-none',
      'data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=end]:animate-out',
      className
    )}
    {...props}
  />
))
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-300 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800 dark:focus:ring-slate-700',
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => {
  const { t } = useTranslation()
  return (
    <ToastPrimitives.Close
      ref={ref}
      className={cn(
        'absolute py-1 px-2 right-1 top-1 rounded-md text-gray-500 opacity-0 transition-opacity hover:text-gray-900 focus:opacity-100 focus:outline-none focus:ring-1 group-hover:opacity-100 dark:text-gray-400 dark:hover:text-gray-50',
        className
      )}
      toast-close=""
      {...props}
    >
      <span className="sr-only">{t('common.close')}</span>
      <span aria-hidden>×</span>
    </ToastPrimitives.Close>
  )
})
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-sm font-semibold [&+div]:text-xs', className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-sm opacity-90', className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
