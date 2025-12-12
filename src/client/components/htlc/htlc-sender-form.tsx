'use client'

import { useState } from 'react'
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
import { Copy } from 'lucide-react'

interface HtlcSenderFormProps {
  onRecipientChange?: (recipientName: string) => void
}

const RECIPIENT_OPTIONS = [
  { name: 'alice', address: 'addr_test1qqhtlccontractplaceholder0000000000000000000' },
  { name: 'bob', address: 'addr_test1qqhtlccontractplaceholder0000000000000000001' },
  { name: 'ida', address: 'addr_test1qqhtlccontractplaceholder0000000000000000002' },
] as const

export default function HtlcSenderForm({
  onRecipientChange,
}: HtlcSenderFormProps) {
  const [form, setForm] = useState({
    recipientName: '',
    amountAda: '',
    htlcHash: '',
    timeout: '60', // in minutes
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
    onRecipientChange?.(value)
  }


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // You'll handle the actual submission logic
    // form.recipientName will be 'alice', 'bob', or 'ida'
    // You'll translate this to the actual address internally
    console.log('Submit HTLC:', form)
  }

  return (
    <Card className="flex flex-col w-[600px]">
      <CardHeader className="p-0 -m-[1px]">
        <CardTitle className="text-center bg-primary text-primary-foreground py-8 rounded-t-lg">
          SENDER
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
              <Button
                type="button"
                variant="secondary"
                onClick={() => pasteTo('amountAda')}
              >
                Paste
              </Button>
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

          <Button className="w-full mt-auto" size="lg" type="submit">
            SEND
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
