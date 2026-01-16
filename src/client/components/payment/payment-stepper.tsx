'use client'

import { PaymentStepState, StepStatus } from '@/lib/use-payment-orchestration'
import { isAutomatedStep } from '@/lib/topologies'
import { CheckCircle2, XCircle, Loader2, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PaymentStepperProps {
  steps: PaymentStepState[]
  currentStepIndex: number | null
}

function getStepIcon(status: StepStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500" />
    case 'in-progress':
    case 'retrying':
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
    case 'pending':
      return <Clock className="h-5 w-5 text-gray-400" />
    default:
      return <Clock className="h-5 w-5 text-gray-400" />
  }
}

function getStepLabel(step: PaymentStepState): string {
  const { step: paymentStep } = step
  const fromName = paymentStep.from.name.charAt(0).toUpperCase() + paymentStep.from.name.slice(1)
  const toName = paymentStep.to.name.charAt(0).toUpperCase() + paymentStep.to.name.slice(1)
  const isAutomated = isAutomatedStep(paymentStep)
  
  if (isAutomated) {
    return `${fromName} → ${toName} (Automated) - Head ${paymentStep.from.head.toUpperCase()}`
  }
  return `${fromName} → ${toName} - Head ${paymentStep.from.head.toUpperCase()}`
}

export default function PaymentStepper({ steps, currentStepIndex }: PaymentStepperProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {steps.map((stepState, index) => {
          const isCurrent = currentStepIndex === index
          const isActive = stepState.status === 'in-progress' || stepState.status === 'retrying'
          const isCompleted = stepState.status === 'completed'
          const isFailed = stepState.status === 'failed'

          return (
            <div
              key={index}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                isCurrent && 'bg-blue-50 border-blue-200',
                isActive && 'bg-blue-50 border-blue-300',
                isCompleted && 'bg-green-50 border-green-200',
                isFailed && 'bg-red-50 border-red-200',
                !isActive && !isCompleted && !isFailed && 'bg-gray-50 border-gray-200'
              )}
            >
              <div className="flex-shrink-0 mt-0.5">{getStepIcon(stepState.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    Step {index + 1}: {getStepLabel(stepState)}
                  </span>
                </div>
                {stepState.txHash && (
                  <div className="mt-1 text-xs text-muted-foreground font-mono">
                    TX: {stepState.txHash.slice(0, 16)}...
                  </div>
                )}
                {stepState.error && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-red-600">
                    <AlertCircle className="h-3 w-3" />
                    <span>{stepState.error}</span>
                  </div>
                )}
                {stepState.status === 'retrying' && stepState.retryCount > 0 && (
                  <div className="mt-1 text-xs text-yellow-600">
                    Retrying... (attempt {stepState.retryCount + 1}/{stepState.retryCount + 1})
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
