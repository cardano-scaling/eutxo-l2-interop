import { Data } from "@lucid-evolution/lucid";

const CredentialSchema = Data.Enum([
  Data.Object({
    Verification_key_cred: Data.Object({ Key: Data.Bytes() }),
  }),
  Data.Object({ Script_cred: Data.Object({ Key: Data.Bytes() }) }),
]);

const AddressSchema = Data.Object({
  payment_credential: CredentialSchema,
  stake_credential: Data.Nullable(
    Data.Object({
      inline: CredentialSchema,
    }),
  ),
});

const LotteryDesiredOutputSchema = Data.Object({
  address: AddressSchema,
  datum: Data.Nullable(Data.Any()),
});

const TicketDatumSchema = Data.Object({
  lottery_id: Data.Bytes(),
  desired_output: LotteryDesiredOutputSchema,
});

const LotteryDatumSchema = Data.Object({
  prize: Data.Integer(),
  ticket_cost: Data.Integer(),
  paid_winner: Data.Boolean(),
  close_timestamp: Data.Integer(),
  admin: Data.Bytes(),
});

const OutputReferenceSchema = Data.Object({
  transaction_id: Data.Bytes(),
  output_index: Data.Integer(),
});

const LotteryMintRedeemerSchema = Data.Enum([
  Data.Object({ Mint: Data.Tuple([OutputReferenceSchema]) }),
  Data.Object({ Burn: Data.Tuple([]) }),
]);

export type TicketDatumT = Data.Static<typeof TicketDatumSchema>;
export const TicketDatum = TicketDatumSchema as unknown as TicketDatumT;
export type LotteryDatumT = Data.Static<typeof LotteryDatumSchema>;
export const LotteryDatum = LotteryDatumSchema as unknown as LotteryDatumT;
export type OutputReferenceT = Data.Static<typeof OutputReferenceSchema>;
export const OutputReference = OutputReferenceSchema as unknown as OutputReferenceT;
export type LotteryMintRedeemerT = Data.Static<typeof LotteryMintRedeemerSchema>;
export const LotteryMintRedeemer = LotteryMintRedeemerSchema as unknown as LotteryMintRedeemerT;
