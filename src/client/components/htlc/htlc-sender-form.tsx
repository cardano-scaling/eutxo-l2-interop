'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAllUsers } from '@/lib/users'
import { useCurrentUser } from '@/lib/use-current-user'
import { useQueryClient } from '@tanstack/react-query'

interface HtlcSenderFormProps {
  onRecipientChange?: (recipientName: string, recipientAddress: string) => void
}

// Get recipient options from users config
const RECIPIENT_OPTIONS = getAllUsers().map((user) => ({
  name: user.name,
  address: user.address,
}))

export default function HtlcSenderForm({
  onRecipientChange,
}: HtlcSenderFormProps) {
  const pathname = usePathname()
  const { currentUser } = useCurrentUser()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const queryInvalidationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const [form, setForm] = useState({
    recipientName: '',
    amountAda: '',
    htlcHash: '',
    timeout: '60', // in minutes
    // Desired output configuration
    desiredOutputType: 'vesting' as 'user' | 'vesting', // 'user' = user address, 'vesting' = vesting contract
    desiredOutputReceiver: '', // User name for desired output (if type is user or vesting)
    desiredOutputDatumTimeout: '120', // Vesting timeout in minutes (only if type is vesting)
  })

  const getClipboardContents = async () => {
    try {
      const text = await navigator.clipboard.readText()
      return text
    } catch (error) {
      console.error('Failed to read clipboard contents: ', error)
    }
  }

  const pasteTo = async (field: 'amountAda' | 'htlcHash') => {
    const clipboardText = await getClipboardContents()
    if (clipboardText && field in form) {
      if (field === 'amountAda') {
        setForm((prev) => ({
          ...prev,
          [field]: isNaN(Number(clipboardText)) ? '' : clipboardText,
        }))
      } else {
        setForm((prev) => ({ ...prev, [field]: clipboardText }))
      }
    }
  }

  const handleRecipientChange = (value: string) => {
    setForm((prev) => ({ ...prev, recipientName: value }))
    const recipient = RECIPIENT_OPTIONS.find((r) => r.name === value)
    if (recipient) {
      onRecipientChange?.(recipient.name, recipient.address)
    }
  }


  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current)
      }
      if (queryInvalidationTimeoutRef.current) {
        clearTimeout(queryInvalidationTimeoutRef.current)
      }
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setIsSubmitting(true)
    
    // Clear any existing timeouts
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current)
    }
    if (queryInvalidationTimeoutRef.current) {
      clearTimeout(queryInvalidationTimeoutRef.current)
    }

    try {
      // Extract head route from pathname (e.g., "/head-a" -> "head-a")
      const headRoute = pathname?.replace('/', '') || 'head-a'

      // Build request body
      const requestBody: any = {
        senderName: currentUser,
        recipientName: form.recipientName,
        amountAda: form.amountAda,
        htlcHash: form.htlcHash,
        timeoutMinutes: form.timeout,
        desiredOutput: {
          type: form.desiredOutputType,
          receiver: form.desiredOutputReceiver,
        },
      }

      // Only add datumTimeoutMinutes if type is vesting
      if (form.desiredOutputType === 'vesting') {
        requestBody.desiredOutput.datumTimeoutMinutes = form.desiredOutputDatumTimeout
      }

      const response = await fetch(`/api/hydra/${headRoute}/htlc/lock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      // Check response status first
      if (!response.ok) {
        // Try to parse error response
        const contentType = response.headers.get('content-type')
        let errorData
        try {
          if (contentType && contentType.includes('application/json')) {
            errorData = await response.json()
          } else {
            const text = await response.text()
            throw new Error(`Server error: ${text || response.statusText}`)
          }
        } catch (parseError) {
          throw new Error(`Server error: ${response.statusText}`)
        }
        const errorMsg = errorData?.error || errorData?.details || 'Failed to lock HTLC'
        const fullErrorMsg = errorData?.details ? `${errorData.error || 'Failed to lock HTLC'}: ${errorData.details}` : errorMsg
        throw new Error(fullErrorMsg)
      }

      // Parse successful response
      const contentType = response.headers.get('content-type')
      let data
      if (contentType && contentType.includes('application/json')) {
        data = await response.json()
      } else {
        const text = await response.text()
        throw new Error(`Invalid response format: ${text || response.statusText}`)
      }

      // Validate response has txHash
      if (!data.txHash) {
        throw new Error('Response missing transaction hash')
      }

      const successMessage = `HTLC locked successfully! TX: ${data.txHash}`
      setSuccess(successMessage)
      
      // Reset form but keep desired output defaults
      setForm({
        recipientName: '',
        amountAda: '',
        htlcHash: '',
        timeout: '60',
        desiredOutputType: 'vesting',
        desiredOutputReceiver: form.desiredOutputReceiver || '', // Keep current or reset
        desiredOutputDatumTimeout: '120',
      })

      // Delay query invalidation to keep success message visible
      // Invalidate UTXO query after showing success message for 3 seconds
      queryInvalidationTimeoutRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['utxos', headRoute] })
      }, 3000)

      // Clear success message after 5 seconds
      successTimeoutRef.current = setTimeout(() => {
        setSuccess(null)
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock HTLC')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="flex flex-col w-[600px]">
      <CardHeader className="p-0 -m-[1px]">
        <CardTitle className="text-center bg-primary text-primary-foreground py-8 rounded-t-lg">
          HTLC SENDER
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col gap-4 p-4"
        >
          <div>
            <Label className="text-sm font-medium mb-2 block">
              Recipient
            </Label>
            <Select
              value={form.recipientName}
              onValueChange={handleRecipientChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select recipient" />
              </SelectTrigger>
              <SelectContent className="w-[var(--radix-select-trigger-width)]">
                <SelectGroup>
                  <SelectLabel>Recipients</SelectLabel>
                  {RECIPIENT_OPTIONS.map((recipient) => (
                    <SelectItem key={recipient.name} value={recipient.name}>
                      <span>
                        <span className="font-medium">
                          {recipient.name.charAt(0).toUpperCase() +
                            recipient.name.slice(1)}
                        </span>
                        <span className="text-muted-foreground font-mono text-xs ml-1">
                          - {recipient.address}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">
              Amount (ADA)
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="Amount (ADA)"
                type="number"
                value={form.amountAda}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, amountAda: e.target.value }))
                }
              />
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">
              HTLC Timeout (minutes)
            </Label>
            <Input
              placeholder="Timeout (minutes)"
              type="number"
              value={form.timeout}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, timeout: e.target.value }))
              }
            />
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">
              HTLC Hash
            </Label>
            <div className="flex gap-2">
              <Input
                id="htlc-hash-input"
                placeholder="Enter HTLC hash"
                type="text"
                value={form.htlcHash}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, htlcHash: e.target.value }))
                }
                className="font-mono"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => pasteTo('htlcHash')}
              >
                Paste
              </Button>
            </div>
          </div>

          {/* Desired Output Configuration */}
          <div className="space-y-4 pt-2 border-t">
            <Label className="text-sm font-semibold block">
              Desired Output Configuration
            </Label>
            
            <div>
              <Label className="text-sm font-medium mb-2 block">
                Output Type
              </Label>
              <Select
                value={form.desiredOutputType}
                onValueChange={(value: 'user' | 'vesting') =>
                  setForm((prev) => ({ ...prev, desiredOutputType: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User Address (no datum)</SelectItem>
                  <SelectItem value="vesting">Vesting Contract (with datum)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Output Receiver
              </Label>
              <Select
                value={form.desiredOutputReceiver}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, desiredOutputReceiver: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select receiver for output" />
                </SelectTrigger>
                <SelectContent className="w-[var(--radix-select-trigger-width)]">
                  <SelectGroup>
                    <SelectLabel>Receivers</SelectLabel>
                    {RECIPIENT_OPTIONS.map((recipient) => (
                      <SelectItem key={recipient.name} value={recipient.name}>
                        <span>
                          <span className="font-medium">
                            {recipient.name.charAt(0).toUpperCase() +
                              recipient.name.slice(1)}
                          </span>
                          <span className="text-muted-foreground font-mono text-xs ml-1">
                            - {recipient.address}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {form.desiredOutputType === 'vesting' && (
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Vesting Timeout (minutes from now)
                </Label>
                <Input
                  placeholder="Vesting timeout (minutes)"
                  type="number"
                  value={form.desiredOutputDatumTimeout}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      desiredOutputDatumTimeout: e.target.value,
                    }))
                  }
                />
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {error}
            </div>
          )}
          {success && (
            <div className="text-sm text-green-600 bg-green-50 p-2 rounded">
              {success}
            </div>
          )}
          <Button 
            className="w-full mt-auto" 
            size="lg" 
            type="submit"
            disabled={
              isSubmitting ||
              !form.recipientName ||
              !form.amountAda ||
              !form.htlcHash ||
              !form.desiredOutputReceiver
            }
          >
            {isSubmitting ? 'Sending...' : 'SEND'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
