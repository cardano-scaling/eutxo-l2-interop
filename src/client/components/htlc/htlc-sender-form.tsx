'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Copy, RefreshCw } from 'lucide-react'
import { formatId } from '@/lib/utils'
import { hydraHeads } from '@/lib/config'

type HeadInfo = {
  name: string
  route: string
  headId: string
  headSeed: string
  tag: string
}

interface HtlcSenderFormProps {
  currentHeadId?: string
  allHeadsInfo?: HeadInfo[]
}

export default function HtlcSenderForm({
  currentHeadId,
  allHeadsInfo = [],
}: HtlcSenderFormProps) {
  const [form, setForm] = useState({
    recipientAddress: '',
    amountAda: '',
    headId: '',
    preimage: '',
    htlcHash: '',
    timeout: '60', // in minutes
  })

  // Filter out current head from options
  const headOptions = allHeadsInfo.filter(
    (head) => head.headId !== currentHeadId
  )

  // Generate preimage and hash
  const generatePreimage = () => {
    const randomText = crypto.randomUUID()
    const preimage = stringToHex(randomText)
    setForm((prev) => ({
      ...prev,
      preimage,
      htlcHash: generateHash(preimage),
    }))
  }

  const stringToHex = (str: string): string => {
    return Array.from(str)
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  }

  const generateHash = (preimage: string): string => {
    // Simple hash simulation - you'll replace this with actual blake2b
    return preimage.slice(0, 64).padEnd(64, '0')
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const pasteFromClipboard = async (field: keyof typeof form) => {
    try {
      const text = await navigator.clipboard.readText()
      if (field === 'amountAda') {
        setForm((prev) => ({ ...prev, [field]: text }))
      } else {
        setForm((prev) => ({ ...prev, [field]: text }))
      }
    } catch (error) {
      console.error('Failed to read clipboard:', error)
    }
  }

  useEffect(() => {
    generatePreimage()
  }, [])

  useEffect(() => {
    if (form.preimage) {
      setForm((prev) => ({
        ...prev,
        htlcHash: generateHash(prev.preimage),
      }))
    }
  }, [form.preimage])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // You'll handle the actual submission logic
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
              Target Head
            </Label>
            <Select
              value={form.headId}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, headId: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select target head" />
              </SelectTrigger>
              <SelectContent align="end" position="popper">
                <SelectGroup>
                  <SelectLabel>Hydra heads</SelectLabel>
                  {headOptions.map((head) => (
                    <SelectItem key={head.headId} value={head.headId}>
                      {head.name} - {formatId(head.headId, 8, 8)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">
              Recipient Address
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="Enter recipient address"
                value={form.recipientAddress}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    recipientAddress: e.target.value,
                  }))
                }
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => pasteFromClipboard('recipientAddress')}
              >
                Paste
              </Button>
            </div>
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
                onClick={() => pasteFromClipboard('amountAda')}
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

          <div className="space-y-2">
            <div className="flex w-full justify-between items-center">
              <Label className="text-sm font-medium block">HTLC Hashed</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="p-0 px-1 h-auto"
                onClick={generatePreimage}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Generate
              </Button>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Preimage</Label>
              <div className="flex gap-2">
                <Textarea
                  placeholder="HTLC Preimage"
                  value={form.preimage}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, preimage: e.target.value }))
                  }
                  rows={3}
                  className="break-all font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => copyToClipboard(form.preimage)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1 block">HTLC Hash</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="HTLC Hash"
                  type="text"
                  value={form.htlcHash}
                  readOnly
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => copyToClipboard(form.htlcHash)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
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
