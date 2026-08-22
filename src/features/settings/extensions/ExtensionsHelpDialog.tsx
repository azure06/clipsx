import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Box, Eye, ShieldCheck, Shuffle, Sparkles, Wand2, X } from 'lucide-react'
import type { ReactNode } from 'react'

const steps: Array<{ label: string; icon?: typeof Sparkles; tone: keyof typeof tone }> = [
  { label: 'Clipboard', tone: 'slate' },
  { label: 'Detector', icon: Sparkles, tone: 'blue' },
  { label: 'Facets', tone: 'slate' },
  { label: 'Renderer', icon: Eye, tone: 'violet' },
  { label: 'Preview', tone: 'slate' },
]

const tone = {
  slate: 'bg-slate-500/8 text-slate-600 dark:text-slate-300',
  blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
}

export const ExtensionsHelpDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-[2px] dark:bg-black/55" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,680px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200/80 bg-slate-50/95 p-5 shadow-[0_28px_80px_-36px_rgba(15,23,42,.55)] outline-none dark:border-white/10 dark:bg-slate-900/95">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/22 to-fuchsia-500/12 text-violet-700 ring-1 ring-violet-500/15 dark:text-violet-200">
            <Wand2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <Dialog.Title className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              How extensions work
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Packages teach ClipsX how to understand, present, and act on copied content. They add
              capabilities without changing your original clip.
            </Dialog.Description>
          </div>
          <Dialog.Close
            aria-label="Close extension help"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-900/[.06] hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:hover:bg-white/[.08] dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </Dialog.Close>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200/75 bg-white/55 p-3 dark:border-white/[.08] dark:bg-white/[.025]">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">
            The extension pipeline
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {steps.map((step, index) => {
              const Icon = step.icon
              return (
                <div key={step.label} className="flex items-center gap-1.5">
                  {index > 0 && (
                    <ArrowRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />
                  )}
                  <span
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${tone[step.tone]}`}
                  >
                    {Icon && <Icon className="h-3 w-3" />}
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            Detectors recognize things such as URLs or structured text and add facets. Renderers use
            those facets to offer a richer preview. ClipsX still keeps the original representations
            unchanged.
          </p>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Explain
            icon={<Sparkles className="h-4 w-4 text-sky-500" />}
            title="Detect"
            text="Recognize content and attach typed facets."
          />
          <Explain
            icon={<Eye className="h-4 w-4 text-violet-500" />}
            title="Render"
            text="Offer an alternate compact or detailed view."
          />
          <Explain
            icon={<Shuffle className="h-4 w-4 text-emerald-500" />}
            title="Transform & act"
            text="Create a preview, copy, paste, save a new clip, or open a declared dialog."
          />
        </div>

        <div className="mt-4 flex gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[.045] px-3 py-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-[11px] leading-5 text-slate-600 dark:text-slate-300">
            <span className="font-semibold">Packages stay isolated.</span> They cannot edit your
            current clip, read arbitrary history, access files, or use the network directly.
            External requests need a declared destination and your consent for that exact release.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
          <Box className="h-3.5 w-3.5 text-violet-500" />
          Manage each package’s settings, permissions, actions, and diagnostics from its detail
          page.
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
)

const Explain = ({ icon, title, text }: { icon: ReactNode; title: string; text: string }) => (
  <div className="rounded-xl border border-slate-200/65 bg-white/35 p-3 dark:border-white/[.08] dark:bg-white/[.025]">
    <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
      {icon}
      {title}
    </div>
    <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{text}</p>
  </div>
)
