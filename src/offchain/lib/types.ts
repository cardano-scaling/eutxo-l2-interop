import { Data } from "@lucid-evolution/lucid";

const HtlcDatumSchema = Data.Object({
    hash: Data.Bytes(),
    timeout: Data.Integer(),
    sender: Data.Bytes(),
    receiver: Data.Bytes(),
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

const VestingDatumSchema = Data.Object({
  timeout: Data.Integer(),
  receiver: Data.Bytes()
})
type VestingDatumT = Data.Static<typeof VestingDatumSchema>
const VestingDatum = VestingDatumSchema as unknown as VestingDatumT


export {
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
}

