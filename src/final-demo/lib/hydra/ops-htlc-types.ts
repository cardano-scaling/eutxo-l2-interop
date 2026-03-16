import { Data } from "@lucid-evolution/lucid";

const CredentialSchema = Data.Enum([
  Data.Object({
    Verification_key_cred: Data.Object({ Key: Data.Bytes() }),
  }),
  Data.Object({
    Script_cred: Data.Object({ Key: Data.Bytes() }),
  }),
]);

const AddressSchema = Data.Object({
  payment_credential: CredentialSchema,
  stake_credential: Data.Nullable(
    Data.Object({
      inline: CredentialSchema,
    }),
  ),
});

const MapAssetsSchema = Data.Map(
  Data.Bytes(),
  Data.Map(Data.Bytes(), Data.Integer()),
);

const DesiredOutputSchema = Data.Object({
  address: AddressSchema,
  value: MapAssetsSchema,
  datum: Data.Nullable(Data.Any()),
});

const HtlcDatumSchema = Data.Object({
  hash: Data.Bytes(),
  timeout: Data.Integer(),
  sender: Data.Bytes(),
  receiver: Data.Bytes(),
  desired_output: DesiredOutputSchema,
});

export type HtlcDatumT = Data.Static<typeof HtlcDatumSchema>;
export const HtlcDatum = HtlcDatumSchema as unknown as HtlcDatumT;

const HtlcRedeemerSchema = Data.Enum([
  Data.Object({
    Claim: Data.Tuple([Data.Bytes()]),
  }),
  Data.Object({
    Refund: Data.Tuple([]),
  }),
]);

export type HtlcRedeemerT = Data.Static<typeof HtlcRedeemerSchema>;
export const HtlcRedeemer = HtlcRedeemerSchema as unknown as HtlcRedeemerT;

