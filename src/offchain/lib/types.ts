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
}

