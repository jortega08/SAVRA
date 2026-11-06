// shadcn/ui Progress backed by the accessible Radix primitive.
import * as ProgressPrimitive from '@radix-ui/react-progress'
export function Progress({ value }: { value: number }) {
  return <ProgressPrimitive.Root className="progress-track" value={value} aria-label="Progreso de la encuesta">
    <ProgressPrimitive.Indicator className="progress-fill" style={{ transform: `translateX(-${100 - value}%)` }} />
  </ProgressPrimitive.Root>
}
