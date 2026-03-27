import { z } from "zod";
import { REQUEST_FUNDS_MAX_LOVELACE } from "@/lib/request-funds-amount";

export const desiredOutputSchema = z.object({
  address: z.string().min(8),
  datum: z.string().nullable().optional(),
});

export type DesiredOutput = z.infer<typeof desiredOutputSchema>;

export const prepareBuyTicketSchema = z.object({
  actor: z.enum(["user", "charlie"]),
  address: z.string().min(8),
  amountLovelace: z.string().regex(/^\d+$/),
  sourceHead: z.enum(["headA", "headC"]),
  htlcHash: z.string().regex(/^[0-9a-fA-F]+$/),
  timeoutMinutes: z.string().regex(/^\d+$/),
});

export type PrepareBuyTicketInput = z.infer<typeof prepareBuyTicketSchema>;

export const submitBuyTicketSchema = z.object({
  unsignedTxCborHex: z.string().regex(/^[0-9a-fA-F]+$/),
  witnessHex: z.string().regex(/^[0-9a-fA-F]+$/),
  sourceHead: z.enum(["headA", "headC"]),
  htlcHash: z.string().regex(/^[0-9a-fA-F]+$/),
  idempotencyKey: z.string().min(1).optional(),
  preimage: z.string().regex(/^[0-9a-fA-F]+$/).optional(),
});

export type SubmitBuyTicketInput = z.infer<typeof submitBuyTicketSchema>;

const requestFundsAmountField = z
  .string()
  .regex(/^\d+$/)
  .refine((s) => {
    try {
      const n = BigInt(s);
      return n > 0n && n <= REQUEST_FUNDS_MAX_LOVELACE;
    } catch {
      return false;
    }
  }, "amountLovelace must be between 1 and max (inclusive)");

export const prepareRequestFundsSchema = z.object({
  address: z.string().min(8),
  amountLovelace: requestFundsAmountField,
});

export type PrepareRequestFundsInput = z.infer<typeof prepareRequestFundsSchema>;

export const submitRequestFundsSchema = z.object({
  unsignedTxCborHex: z.string().regex(/^[0-9a-fA-F]+$/),
  witnessHex: z.string().regex(/^[0-9a-fA-F]+$/),
  amountLovelace: requestFundsAmountField,
});

export type SubmitRequestFundsInput = z.infer<typeof submitRequestFundsSchema>;

export type PreparedBuyTicketDraft = {
  id: string;
  createdAtMs: number;
  expiresAtMs: number;
  sourceHead: "headA" | "headC";
  unsignedTxCborHex: string;
  txBodyHash: string;
  summary: {
    sourceHead: "headA" | "headC";
    amountLovelace: string;
    htlcHash: string;
    timeoutMinutes: string;
    desiredOutput: DesiredOutput;
  };
};
