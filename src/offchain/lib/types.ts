import { Data } from "@lucid-evolution/lucid";


/**
 * Common Types
 */
const CredentialSchema = Data.Enum([
  Data.Object({
    Verification_key_cred: Data.Object({ Key: Data.Bytes() }),
  }),
  Data.Object({ Script_cred: Data.Object({ Key: Data.Bytes() }) }),
]);
type CredentialT = Data.Static<typeof CredentialSchema>;

const AddressSchema = Data.Object({
  payment_credential: CredentialSchema,
  stake_credential: Data.Nullable(
    Data.Object({
      inline: CredentialSchema,
    })
  ),
});
type AddressT = Data.Static<typeof AddressSchema>;
const Address = AddressSchema as unknown as AddressT;

const MapAssetsSchema = Data.Map(
  Data.Bytes(),
  Data.Map(Data.Bytes(), Data.Integer())
);
type MapAssetsT = Data.Static<typeof MapAssetsSchema>;

/**
 * HTLC Types
 */

const DesiredOutputSchema = Data.Object({
  address: AddressSchema,
  value: MapAssetsSchema,
  datum: Data.Nullable(Data.Any())
});
type DesiredOutputT = Data.Static<typeof DesiredOutputSchema>
const DesiredOutput = DesiredOutputSchema as unknown as DesiredOutputT

const HtlcDatumSchema = Data.Object({
  hash: Data.Bytes(),
  timeout: Data.Integer(),
  sender: Data.Bytes(),
  receiver: Data.Bytes(),
  desired_output: DesiredOutputSchema,
})
type HtlcDatumT = Data.Static<typeof HtlcDatumSchema>
const HtlcDatum = HtlcDatumSchema as unknown as HtlcDatumT


const HtlcRedeemerSchema = Data.Enum([
  Data.Object({
    Claim: Data.Tuple([Data.Bytes()])
  }),
  Data.Object({
    Refund: Data.Tuple([])
  })
]);

type HtlcRedeemerT = Data.Static<typeof HtlcRedeemerSchema>;
const HtlcRedeemer = HtlcRedeemerSchema as unknown as HtlcRedeemerT;

namespace Spend {
  export const Refund = Data.to<HtlcRedeemerT>({ Refund: [] }, HtlcRedeemer);
}

/**
 * Vesting Types
*/

const VestingDatumSchema = Data.Object({
  vest_after: Data.Integer(),
  receiver: Data.Bytes()
})
type VestingDatumT = Data.Static<typeof VestingDatumSchema>
const VestingDatum = VestingDatumSchema as unknown as VestingDatumT


/**
 * Lottery Types
 */

const LotteryDatumSchema = Data.Object({
  prize: Data.Integer(),
  ticket_cost: Data.Integer(),
  paid_winner: Data.Boolean(),
  close_timestamp: Data.Integer(),
  admin: Data.Bytes(),
})
type LotteryDatumT = Data.Static<typeof LotteryDatumSchema>
const LotteryDatum = LotteryDatumSchema as unknown as LotteryDatumT

const OutputReferenceSchema = Data.Object({
  transaction_id: Data.Bytes(),
  output_index: Data.Integer(),
})
type OutputReferenceT = Data.Static<typeof OutputReferenceSchema>
const OutputReference = OutputReferenceSchema as unknown as OutputReferenceT

const LotteryRedeemerSchema = Data.Enum([
  Data.Object({ PayWinner: Data.Tuple([OutputReferenceSchema]) }),
  Data.Object({ Close: Data.Tuple([]) }),
])
type LotteryRedeemerT = Data.Static<typeof LotteryRedeemerSchema>
const LotteryRedeemer = LotteryRedeemerSchema as unknown as LotteryRedeemerT

const LotteryMintRedeemerSchema = Data.Enum([
  Data.Object({ Mint: Data.Tuple([OutputReferenceSchema]) }),
  Data.Object({ Burn: Data.Tuple([]) }),
])
type LotteryMintRedeemerT = Data.Static<typeof LotteryMintRedeemerSchema>
const LotteryMintRedeemer = LotteryMintRedeemerSchema as unknown as LotteryMintRedeemerT

const LotteryDesiredOutputSchema = Data.Object({
  address: AddressSchema,
  datum: Data.Nullable(Data.Any()),
})
type LotteryDesiredOutputT = Data.Static<typeof LotteryDesiredOutputSchema>
const LotteryDesiredOutput = LotteryDesiredOutputSchema as unknown as LotteryDesiredOutputT

const TicketDatumSchema = Data.Object({
  lottery_id: Data.Bytes(),
  desired_output: LotteryDesiredOutputSchema,
})
type TicketDatumT = Data.Static<typeof TicketDatumSchema>
const TicketDatum = TicketDatumSchema as unknown as TicketDatumT

const TicketRedeemerSchema = Data.Enum([
  Data.Object({ Win: Data.Tuple([]) }),
  Data.Object({ Lose: Data.Tuple([]) }),
])
type TicketRedeemerT = Data.Static<typeof TicketRedeemerSchema>
const TicketRedeemer = TicketRedeemerSchema as unknown as TicketRedeemerT


export {
  CredentialSchema,
  CredentialT,
  AddressSchema,
  AddressT,
  Address,
  MapAssetsSchema,
  MapAssetsT,
  DesiredOutputSchema,
  DesiredOutputT,
  DesiredOutput,
  HtlcDatumSchema,
  HtlcDatumT,
  HtlcDatum,
  HtlcRedeemerSchema,
  HtlcRedeemer,
  HtlcRedeemerT,
  Spend,
  VestingDatumSchema,
  VestingDatumT,
  VestingDatum,
  LotteryDatumSchema,
  LotteryDatumT,
  LotteryDatum,
  OutputReferenceSchema,
  OutputReferenceT,
  OutputReference,
  LotteryRedeemerSchema,
  LotteryRedeemerT,
  LotteryRedeemer,
  LotteryMintRedeemerSchema,
  LotteryMintRedeemerT,
  LotteryMintRedeemer,
  LotteryDesiredOutputSchema,
  LotteryDesiredOutputT,
  LotteryDesiredOutput,
  TicketDatumSchema,
  TicketDatumT,
  TicketDatum,
  TicketRedeemerSchema,
  TicketRedeemerT,
  TicketRedeemer,
}

