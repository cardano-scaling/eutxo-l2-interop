'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { PaymentState, StepStatus, usePaymentOrchestration } from '@/lib/use-payment-orchestration'
import { PaymentStep } from '@/lib/topologies'
import { UserName } from '@/lib/users'

type PaymentContextType = {
  paymentState: PaymentState | null
  executePayment: (
    steps: PaymentStep[],
    paymentConfig: {
      amountAda: string
      htlcHash: string
      timeoutMinutes: string
      finalReceiver: UserName // Final target receiver (for last step)
      preimage?: string
    },
    onStepUpdate?: (stepIndex: number, status: StepStatus, txHash?: string, error?: string) => void
  ) => Promise<void>
  resetPayment: () => void
  cancelPayment: () => void
}

const PaymentContext = createContext<PaymentContextType | undefined>(undefined)

const STORAGE_KEY = 'payment-state'

export function PaymentProvider({ children }: { children: React.ReactNode }) {
  const orchestration = usePaymentOrchestration()
  const [isHydrated, setIsHydrated] = useState(false)

  // Load persisted state on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        // Note: We can't fully restore the payment state from localStorage
        // because it contains functions and complex objects. We'll just clear it
        // and let the user start fresh. The payment state will be managed in memory.
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch (error) {
      console.error('Error loading payment state:', error)
    }

    setIsHydrated(true)
  }, [])

  // Persist state to localStorage when it changes
  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return

    if (orchestration.paymentState) {
      // Only persist if payment is completed or failed (not in progress)
      // This way we don't try to restore an in-progress payment
      if (!orchestration.paymentState.isExecuting) {
        try {
          // Store a simplified version for reference
          const simplified = {
            steps: orchestration.paymentState.steps.map((step) => ({
              stepIndex: step.stepIndex,
              status: step.status,
              txHash: step.txHash,
              error: step.error,
            })),
            isExecuting: orchestration.paymentState.isExecuting,
            currentStepIndex: orchestration.paymentState.currentStepIndex,
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(simplified))
        } catch (error) {
          console.error('Error persisting payment state:', error)
        }
      }
    } else {
      // Clear storage when payment is reset
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [orchestration.paymentState, isHydrated])

  // Wrapper to reset and clear storage
  const handleReset = useCallback(() => {
    orchestration.resetPayment()
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [orchestration])

  // Wrapper to execute payment and clear old state
  const handleExecutePayment = useCallback(
    async (
      steps: PaymentStep[],
      paymentConfig: {
        amountAda: string
        htlcHash: string
        timeoutMinutes: string
        finalReceiver: UserName // Final target receiver (for last step)
        preimage?: string
      },
      onStepUpdate?: (stepIndex: number, status: StepStatus, txHash?: string, error?: string) => void
    ) => {
      // Clear any existing payment state before starting new one
      handleReset()
      return orchestration.executePayment(steps, paymentConfig, onStepUpdate)
    },
    [orchestration, handleReset]
  )

  // Always render the provider, even during hydration
  // The hydration check only affects localStorage operations
  return (
    <PaymentContext.Provider
      value={{
        paymentState: orchestration.paymentState,
        executePayment: handleExecutePayment,
        resetPayment: handleReset,
        cancelPayment: orchestration.cancelPayment,
      }}
    >
      {children}
    </PaymentContext.Provider>
  )
}

export function usePayment() {
  const context = useContext(PaymentContext)
  if (context === undefined) {
    throw new Error('usePayment must be used within a PaymentProvider')
  }
  return context
}
