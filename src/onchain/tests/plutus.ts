// deno-lint-ignore-file
import {
  applyParamsToScript,
  Data,
  Script,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";

export type Bool = boolean;
export type ByteArray = string;
export type Data = Data;
export type Int = bigint;
export type ListAdhocLedgerV4WrappedOutput = Array<AdhocLedgerV4WrappedOutput>;
export type ListAikenCryptoVerificationKeyHash = Array<
  AikenCryptoVerificationKeyHash
>;
export type ListCardanoTransactionOutputReference = Array<
  CardanoTransactionOutputReference
>;
export type OptionData = Data | null;
export type OptionCardanoAddressStakeCredential =
  | CardanoAddressStakeCredential
  | null;
export type PairsAikenCryptoVerificationKeyHashInt = Map<
  AikenCryptoVerificationKeyHash,
  Int
>;
export type PairsCardanoAssetsAssetNameInt = Map<CardanoAssetsAssetName, Int>;
export type PairsCardanoAssetsPolicyIdPairsCardanoAssetsAssetNameInt = Map<
  CardanoAssetsPolicyId,
  PairsCardanoAssetsAssetNameInt
>;
export type PairsCardanoTransactionTransactionIdListCardanoTransactionOutputReference =
  Map<CardanoTransactionTransactionId, ListCardanoTransactionOutputReference>;
export type AdhocLedgerV1LpRedeemer = {
  Verify: { performTxHash: CardanoTransactionTransactionId };
} | "Perform";
export type AdhocLedgerV1ReservedDatum = {
  reservedUtxos:
    PairsCardanoTransactionTransactionIdListCardanoTransactionOutputReference;
};
export type AdhocLedgerV2LpDatum = {
  owner: AikenCryptoVerificationKeyHash;
  intermediaries: ListAikenCryptoVerificationKeyHash;
};
export type AdhocLedgerV2LpMintRedeemer = "MintVerified" | "BurnVerified";
export type AdhocLedgerV2LpSpendRedeemer = "Verify" | "Perform";
export type AdhocLedgerV4VerifiedDatum = {
  inputs: ListAdhocLedgerV4WrappedOutput;
  outputs: ListAdhocLedgerV4WrappedOutput;
};
export type AdhocLedgerV4VerifiedRedeemer = "Revert" | "Perform";
export type AdhocLedgerV4WrappedDatum = {
  owner: AikenCryptoVerificationKeyHash;
  intermediaries: PairsAikenCryptoVerificationKeyHashInt;
  nonce: CardanoTransactionOutputReference;
  disputed: Bool;
};
export type AdhocLedgerV4WrappedOutput = {
  datum: AdhocLedgerV4WrappedDatum;
  lovelace: Int;
};
export type AdhocLedgerV4WrappedRedeemer = "Dispute" | "Verify";
export type AikenCryptoScriptHash = string;
export type AikenCryptoVerificationKeyHash = string;
export type CardanoAddressAddress = {
  paymentCredential: CardanoAddressPaymentCredential;
  stakeCredential: OptionCardanoAddressStakeCredential;
};
export type CardanoAddressCredential = {
  VerificationKey: [AikenCryptoVerificationKeyHash];
} | { Script: [AikenCryptoScriptHash] };
export type CardanoAddressPaymentCredential = {
  VerificationKey: [AikenCryptoVerificationKeyHash];
} | { Script: [AikenCryptoScriptHash] };
export type CardanoAddressStakeCredential = {
  Inline: [CardanoAddressCredential];
} | {
  Pointer: { slotNumber: Int; transactionIndex: Int; certificateIndex: Int };
};
export type CardanoAssetsAssetName = string;
export type CardanoAssetsPolicyId = string;
export type CardanoTransactionOutputReference = {
  transactionId: ByteArray;
  outputIndex: Int;
};
export type CardanoTransactionRedeemer = Data;
export type CardanoTransactionTransactionId = string;
export type HtlcDesiredOutput = {
  address: CardanoAddressAddress;
  value: PairsCardanoAssetsPolicyIdPairsCardanoAssetsAssetNameInt;
  datum: OptionData;
};
export type HtlcHtlcDatum = {
  hash: ByteArray;
  timeout: Int;
  sender: ByteArray;
  receiver: ByteArray;
  desiredOutput: HtlcDesiredOutput;
};
export type HtlcRedeemer = { Claim: [ByteArray] } | "Refund";
export type VestingVestingDatum = { vestAfter: Int; receiver: ByteArray };

const definitions = {
  "Bool": {
    "title": "Bool",
    "anyOf": [{
      "title": "False",
      "dataType": "constructor",
      "index": 0,
      "fields": [],
    }, {
      "title": "True",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "ByteArray": { "dataType": "bytes" },
  "Data": { "title": "Data", "description": "Any Plutus data." },
  "Int": { "dataType": "integer" },
  "List$adhoc_ledger_v4/WrappedOutput": {
    "dataType": "list",
    "items": { "$ref": "#/definitions/adhoc_ledger_v4/WrappedOutput" },
  },
  "List$aiken/crypto/VerificationKeyHash": {
    "dataType": "list",
    "items": { "$ref": "#/definitions/aiken/crypto/VerificationKeyHash" },
  },
  "List$cardano/transaction/OutputReference": {
    "dataType": "list",
    "items": { "$ref": "#/definitions/cardano/transaction/OutputReference" },
  },
  "Option$Data": {
    "title": "Option",
    "anyOf": [{
      "title": "Some",
      "description": "An optional value.",
      "dataType": "constructor",
      "index": 0,
      "fields": [{ "$ref": "#/definitions/Data" }],
    }, {
      "title": "None",
      "description": "Nothing.",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "Option$cardano/address/StakeCredential": {
    "title": "Option",
    "anyOf": [{
      "title": "Some",
      "description": "An optional value.",
      "dataType": "constructor",
      "index": 0,
      "fields": [{ "$ref": "#/definitions/cardano/address/StakeCredential" }],
    }, {
      "title": "None",
      "description": "Nothing.",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "Pairs$aiken/crypto/VerificationKeyHash_Int": {
    "title": "Pairs<VerificationKeyHash, Int>",
    "dataType": "map",
    "keys": { "$ref": "#/definitions/aiken/crypto/VerificationKeyHash" },
    "values": { "$ref": "#/definitions/Int" },
  },
  "Pairs$cardano/assets/AssetName_Int": {
    "title": "Pairs<AssetName, Int>",
    "dataType": "map",
    "keys": { "$ref": "#/definitions/cardano/assets/AssetName" },
    "values": { "$ref": "#/definitions/Int" },
  },
  "Pairs$cardano/assets/PolicyId_Pairs$cardano/assets/AssetName_Int": {
    "title": "Pairs<PolicyId, Pairs<AssetName, Int>>",
    "dataType": "map",
    "keys": { "$ref": "#/definitions/cardano/assets/PolicyId" },
    "values": { "$ref": "#/definitions/Pairs$cardano/assets/AssetName_Int" },
  },
  "Pairs$cardano/transaction/TransactionId_List$cardano/transaction/OutputReference":
    {
      "title": "Pairs<TransactionId, List<OutputReference>>",
      "dataType": "map",
      "keys": { "$ref": "#/definitions/cardano/transaction/TransactionId" },
      "values": {
        "$ref": "#/definitions/List$cardano/transaction/OutputReference",
      },
    },
  "adhoc_ledger_v1/LpRedeemer": {
    "title": "LpRedeemer",
    "anyOf": [{
      "title": "Verify",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "performTxHash",
        "$ref": "#/definitions/cardano/transaction/TransactionId",
      }],
    }, {
      "title": "Perform",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "adhoc_ledger_v1/ReservedDatum": {
    "title": "ReservedDatum",
    "anyOf": [{
      "title": "ReservedDatum",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "reservedUtxos",
        "$ref":
          "#/definitions/Pairs$cardano/transaction/TransactionId_List$cardano/transaction/OutputReference",
      }],
    }],
  },
  "adhoc_ledger_v2/LpDatum": {
    "title": "LpDatum",
    "anyOf": [{
      "title": "LpDatum",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "owner",
        "$ref": "#/definitions/aiken/crypto/VerificationKeyHash",
      }, {
        "title": "intermediaries",
        "$ref": "#/definitions/List$aiken/crypto/VerificationKeyHash",
      }],
    }],
  },
  "adhoc_ledger_v2/LpMintRedeemer": {
    "title": "LpMintRedeemer",
    "anyOf": [{
      "title": "MintVerified",
      "dataType": "constructor",
      "index": 0,
      "fields": [],
    }, {
      "title": "BurnVerified",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "adhoc_ledger_v2/LpSpendRedeemer": {
    "title": "LpSpendRedeemer",
    "anyOf": [{
      "title": "Verify",
      "dataType": "constructor",
      "index": 0,
      "fields": [],
    }, {
      "title": "Perform",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "adhoc_ledger_v4/VerifiedDatum": {
    "title": "VerifiedDatum",
    "anyOf": [{
      "title": "VerifiedDatum",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "inputs",
        "$ref": "#/definitions/List$adhoc_ledger_v4/WrappedOutput",
      }, {
        "title": "outputs",
        "$ref": "#/definitions/List$adhoc_ledger_v4/WrappedOutput",
      }],
    }],
  },
  "adhoc_ledger_v4/VerifiedRedeemer": {
    "title": "VerifiedRedeemer",
    "anyOf": [{
      "title": "Revert",
      "dataType": "constructor",
      "index": 0,
      "fields": [],
    }, {
      "title": "Perform",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "adhoc_ledger_v4/WrappedDatum": {
    "title": "WrappedDatum",
    "anyOf": [{
      "title": "WrappedDatum",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "owner",
        "$ref": "#/definitions/aiken/crypto/VerificationKeyHash",
      }, {
        "title": "intermediaries",
        "$ref": "#/definitions/Pairs$aiken/crypto/VerificationKeyHash_Int",
      }, {
        "title": "nonce",
        "$ref": "#/definitions/cardano/transaction/OutputReference",
      }, { "title": "disputed", "$ref": "#/definitions/Bool" }],
    }],
  },
  "adhoc_ledger_v4/WrappedOutput": {
    "title": "WrappedOutput",
    "anyOf": [{
      "title": "WrappedOutput",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "datum",
        "$ref": "#/definitions/adhoc_ledger_v4/WrappedDatum",
      }, { "title": "lovelace", "$ref": "#/definitions/Int" }],
    }],
  },
  "adhoc_ledger_v4/WrappedRedeemer": {
    "title": "WrappedRedeemer",
    "anyOf": [{
      "title": "Dispute",
      "dataType": "constructor",
      "index": 0,
      "fields": [],
    }, {
      "title": "Verify",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "aiken/crypto/ScriptHash": { "title": "ScriptHash", "dataType": "bytes" },
  "aiken/crypto/VerificationKeyHash": {
    "title": "VerificationKeyHash",
    "dataType": "bytes",
  },
  "cardano/address/Address": {
    "title": "Address",
    "description":
      "A Cardano `Address` typically holding one or two credential references.\n\n Note that legacy bootstrap addresses (a.k.a. 'Byron addresses') are\n completely excluded from Plutus contexts. Thus, from an on-chain\n perspective only exists addresses of type 00, 01, ..., 07 as detailed\n in [CIP-0019 :: Shelley Addresses](https://github.com/cardano-foundation/CIPs/tree/master/CIP-0019/#shelley-addresses).",
    "anyOf": [{
      "title": "Address",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "paymentCredential",
        "$ref": "#/definitions/cardano/address/PaymentCredential",
      }, {
        "title": "stakeCredential",
        "$ref": "#/definitions/Option$cardano/address/StakeCredential",
      }],
    }],
  },
  "cardano/address/Credential": {
    "title": "Credential",
    "description":
      "A general structure for representing an on-chain `Credential`.\n\n Credentials are always one of two kinds: a direct public/private key\n pair, or a script (native or Plutus).",
    "anyOf": [{
      "title": "VerificationKey",
      "dataType": "constructor",
      "index": 0,
      "fields": [{ "$ref": "#/definitions/aiken/crypto/VerificationKeyHash" }],
    }, {
      "title": "Script",
      "dataType": "constructor",
      "index": 1,
      "fields": [{ "$ref": "#/definitions/aiken/crypto/ScriptHash" }],
    }],
  },
  "cardano/address/PaymentCredential": {
    "title": "PaymentCredential",
    "description":
      "A general structure for representing an on-chain `Credential`.\n\n Credentials are always one of two kinds: a direct public/private key\n pair, or a script (native or Plutus).",
    "anyOf": [{
      "title": "VerificationKey",
      "dataType": "constructor",
      "index": 0,
      "fields": [{ "$ref": "#/definitions/aiken/crypto/VerificationKeyHash" }],
    }, {
      "title": "Script",
      "dataType": "constructor",
      "index": 1,
      "fields": [{ "$ref": "#/definitions/aiken/crypto/ScriptHash" }],
    }],
  },
  "cardano/address/StakeCredential": {
    "title": "StakeCredential",
    "description":
      "Represent a type of object that can be represented either inline (by hash)\n or via a reference (i.e. a pointer to an on-chain location).\n\n This is mainly use for capturing pointers to a stake credential\n registration certificate in the case of so-called pointer addresses.",
    "anyOf": [{
      "title": "Inline",
      "dataType": "constructor",
      "index": 0,
      "fields": [{ "$ref": "#/definitions/cardano/address/Credential" }],
    }, {
      "title": "Pointer",
      "dataType": "constructor",
      "index": 1,
      "fields": [{ "title": "slotNumber", "$ref": "#/definitions/Int" }, {
        "title": "transactionIndex",
        "$ref": "#/definitions/Int",
      }, { "title": "certificateIndex", "$ref": "#/definitions/Int" }],
    }],
  },
  "cardano/assets/AssetName": { "title": "AssetName", "dataType": "bytes" },
  "cardano/assets/PolicyId": { "title": "PolicyId", "dataType": "bytes" },
  "cardano/transaction/OutputReference": {
    "title": "OutputReference",
    "description":
      "An `OutputReference` is a unique reference to an output on-chain. The `output_index`\n corresponds to the position in the output list of the transaction (identified by its id)\n that produced that output",
    "anyOf": [{
      "title": "OutputReference",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "transactionId",
        "$ref": "#/definitions/ByteArray",
      }, { "title": "outputIndex", "$ref": "#/definitions/Int" }],
    }],
  },
  "cardano/transaction/Redeemer": {
    "title": "Redeemer",
    "description": "Any Plutus data.",
  },
  "cardano/transaction/TransactionId": {
    "title": "TransactionId",
    "dataType": "bytes",
  },
  "htlc/DesiredOutput": {
    "title": "DesiredOutput",
    "anyOf": [{
      "title": "DesiredOutput",
      "dataType": "constructor",
      "index": 0,
      "fields": [{
        "title": "address",
        "$ref": "#/definitions/cardano/address/Address",
      }, {
        "title": "value",
        "$ref":
          "#/definitions/Pairs$cardano/assets/PolicyId_Pairs$cardano/assets/AssetName_Int",
      }, { "title": "datum", "$ref": "#/definitions/Option$Data" }],
    }],
  },
  "htlc/HtlcDatum": {
    "title": "HtlcDatum",
    "anyOf": [{
      "title": "HtlcDatum",
      "dataType": "constructor",
      "index": 0,
      "fields": [
        { "title": "hash", "$ref": "#/definitions/ByteArray" },
        { "title": "timeout", "$ref": "#/definitions/Int" },
        { "title": "sender", "$ref": "#/definitions/ByteArray" },
        { "title": "receiver", "$ref": "#/definitions/ByteArray" },
        {
          "title": "desiredOutput",
          "$ref": "#/definitions/htlc/DesiredOutput",
        },
      ],
    }],
  },
  "htlc/Redeemer": {
    "title": "Redeemer",
    "anyOf": [{
      "title": "Claim",
      "dataType": "constructor",
      "index": 0,
      "fields": [{ "$ref": "#/definitions/ByteArray" }],
    }, {
      "title": "Refund",
      "dataType": "constructor",
      "index": 1,
      "fields": [],
    }],
  },
  "vesting/VestingDatum": {
    "title": "VestingDatum",
    "anyOf": [{
      "title": "VestingDatum",
      "dataType": "constructor",
      "index": 0,
      "fields": [{ "title": "vestAfter", "$ref": "#/definitions/Int" }, {
        "title": "receiver",
        "$ref": "#/definitions/ByteArray",
      }],
    }],
  },
};

export interface AdhocLedgerV1LpV1Spend {
  new (seed: CardanoTransactionOutputReference): Script;
  datumOpt: AdhocLedgerV1ReservedDatum;
  redeemer: AdhocLedgerV1LpRedeemer;
}

export const AdhocLedgerV1LpV1Spend = Object.assign(
  function (seed: CardanoTransactionOutputReference) {
    return {
      type: "PlutusV3",
      script: applyParamsToScript(
        [seed],
        "59098a010100229800aba4aba2aba1aba0aab9faab9eaab9dab9a48888888966003300130033754013370e900048c01cc020c0200066e1d20029ba5480024600e6010003223233001001003223300300130020029ba54800a6e1d2004488888888a60026020013300f009912cc004c028c034dd500144c8c8cc8966002602c0070058b2026375a60260026eb8c04c008c04c004c038dd500145900c4888c9660026014601e6ea80062900044dd6980998081baa001403864b3001300a300f375400314c103d87a8000899198008009bab30143011375400444b30010018a6103d87a8000899192cc004cdc8803000c56600266e3c0180062601a6602c602800497ae08a60103d87a80004049133004004301800340486eb8c048004c054005013201c32330010010042259800800c5300103d87a8000899192cc004cdc8803000c56600266e3c018006260186602a602600497ae08a60103d87a80004045133004004301700340446eb8c044004c050005012488c8cc00400400c896600200314c0103d87a80008992cc004c010006260146602600297ae0899801801980a801201e3013001404491111194c004c044dd5000c88cc0100088cdd7980c180a9baa001002980a8032444b3001300f003899199119912cc004c05800626464b3001302000280245901d1bae301e001301a375400d159800980a000c56600260346ea801a00516406d16406080c05660026028602e6ea80122646644646644b3001301a301d375400313259800980c980f1baa001899192cc004c074c080dd5000c4c966002b30013300100823259800980c98119baa0018acc004cdd7980d198131ba90054bd70181398121baa302730243754603860486ea800a26644b30010018acc004c088c094dd5000c4c9660020030038992cc004006009132598009816801c4cc080004896600200514a11323259800800c026013009804c4cc896600200300b805c4cc098dd6000912cc00400a2600e606a01113259800800c566002605c60626ea8006264b3001001807c4c96600200301080840420211332259800800c04a264b3001001809c04e02713259800981e001c4c020c0f002602881c8dd6800c04d03c181c800a06e375c002607000481c8c0d800503418191baa0018072060807403a01d00e40dc6068004819201700b40d06eb8004c0b4009032181580098170012058802a0543756003004802401102d1815000a050302637540030024091002801400a0048158528981398121baa0018a504089164088603c60466ea8c06cc08cdd5000c528c52820468992cc004c07cc088dd500644cc8966002603460486ea8006264b3001302230253754003132598009815800c4c8cc07c004896600200515980099baf374c0066e9801e2b30013375e6e9c038dd39919800800994c0040060154bd6f7b630200222259800801440063300100398190014c9660026048605c6ea8006264b3001302c302f37540031323259800981b000c4cc88cc0ac0048966002005132329800800c017300100b80352000400880088896600200510018cc00400e607c0059800800cdd7181e801520004010801903b1111919800800802112cc00400626607a66ec0dd48021ba80034bd6f7b63044ca60026eb8c0ec0066eb4c0f000660800049112cc004cdc8004001c4cc104cdd81ba9008375000e00b15980099b8f00800389982099bb037520106ea001c00626608266ec0dd48019ba80023300600600140f481e8607c00281e2264600460760066eb8c0e40090371bae30350023758606a0031640cc606a00260606ea80062c8170c0c8c0bcdd5000c5902d181498171baa3026302e37546062004801902f112cc004006297ae089981718159817800998010011818000a05a8a518b20508b205089919198119bac302c002225980080144c014c0c801a26604060620042600260640048178dd7181500098168012056375660540031640a0604c6ea80062c8120c0a0c094dd5000c59023194c004c8cc004004dd5981418129baa30283025375401c44b30010018a5eb7bdb182265300133003003302b0029bae30260019bac302700140106052002813a6eb8c09cc090dd50084c8cc00400400c896600200314bd7044cc0a0c0a4c098dd51814800998010011815000a04e4004444646600200200844b300100189981519bb037520086e9c00d2f5bded8c113298009bae30280019bac302900198168012444b30013372001000713302e337606ea4020dd3803802c56600266e3c02000e26605c66ec0dd48041ba700700189981719bb037520066e9c008cc01801800502a20541815800a052301e30233754604c60466ea800e2c8108cc004dd618128049192cc004c064c08cdd5000c56600266ebcc068cc098dd4802a5eb80c09cc090dd5181398121baa301c302437540051332259800800c5660026044604a6ea8006264b3001001801c4c96600200300480240120091332259800800c01a264b3001001803c01e264b30013030003899811800912cc00400a2946264b3001001805c02e01700b8991801981a0021bae00140d06062004817a0108168dd6000c01e00e8180c0b400502b1bae001302c00240b460540028140c098dd5000c009024400a005002801205614a0604e60486ea80062941022459022180f18119baa301b3023375400316408044646600200200644b30010018a5eb8226644b3001300500289981480119802002000c4cc01001000502518140009814800a04c8b203e330103758604600a4603730013756603260426ea800600548810040486eb8c088c07cdd5000c5901d1810980f1baa3021301e3754602c603c6ea8c084c078dd5000c5901c1bac301f30203020302030203020302000133009002006301f002301d0013758603800260306ea802e2945016180b9baa00430190013019301a001301537540091598009808801c4c8cc89660026028602e6ea8cc014dd6180d80180fc566002602530013756603660386038005001a44100402513259800980a980c1baa0018992cc004cdd7980e980d1baa301d301a37540026020660386ea400d2f5c1132598009808180d1baa0018992cc004c060c06cdd5000c4c96600260420031323301500122598008014566002b30010038a518a50408514a316407913232330193758604400444b300100289802981400344cc058c09c0084c004c0a00090251bae3020001302300240846eacc0800062c80f0c070dd5000c5901a180f180d9baa0018b20323015301a3754003164060603860326ea80062c80b8cc020dd6180d80111809cc004dd59808980c9baa0018015221004029164059164058603460340026eb8c064c058dd5002980a9baa0088b2026404c30143015005229344d95900101",
        {
          "shape": {
            "dataType": "list",
            "items": [{
              "$ref": "#/definitions/cardano/transaction/OutputReference",
            }],
          },
          definitions,
        } as any,
      ),
    };
  },
  {
    datumOpt: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v1/ReservedDatum" },
      definitions,
    },
  },
  {
    redeemer: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v1/LpRedeemer" },
      definitions,
    },
  },
) as unknown as AdhocLedgerV1LpV1Spend;

export interface AdhocLedgerV1LpV1Mint {
  new (seed: CardanoTransactionOutputReference): Script;
  _redeemer: CardanoTransactionRedeemer;
}

export const AdhocLedgerV1LpV1Mint = Object.assign(
  function (seed: CardanoTransactionOutputReference) {
    return {
      type: "PlutusV3",
      script: applyParamsToScript(
        [seed],
        "59098a010100229800aba4aba2aba1aba0aab9faab9eaab9dab9a48888888966003300130033754013370e900048c01cc020c0200066e1d20029ba5480024600e6010003223233001001003223300300130020029ba54800a6e1d2004488888888a60026020013300f009912cc004c028c034dd500144c8c8cc8966002602c0070058b2026375a60260026eb8c04c008c04c004c038dd500145900c4888c9660026014601e6ea80062900044dd6980998081baa001403864b3001300a300f375400314c103d87a8000899198008009bab30143011375400444b30010018a6103d87a8000899192cc004cdc8803000c56600266e3c0180062601a6602c602800497ae08a60103d87a80004049133004004301800340486eb8c048004c054005013201c32330010010042259800800c5300103d87a8000899192cc004cdc8803000c56600266e3c018006260186602a602600497ae08a60103d87a80004045133004004301700340446eb8c044004c050005012488c8cc00400400c896600200314c0103d87a80008992cc004c010006260146602600297ae0899801801980a801201e3013001404491111194c004c044dd5000c88cc0100088cdd7980c180a9baa001002980a8032444b3001300f003899199119912cc004c05800626464b3001302000280245901d1bae301e001301a375400d159800980a000c56600260346ea801a00516406d16406080c05660026028602e6ea80122646644646644b3001301a301d375400313259800980c980f1baa001899192cc004c074c080dd5000c4c966002b30013300100823259800980c98119baa0018acc004cdd7980d198131ba90054bd70181398121baa302730243754603860486ea800a26644b30010018acc004c088c094dd5000c4c9660020030038992cc004006009132598009816801c4cc080004896600200514a11323259800800c026013009804c4cc896600200300b805c4cc098dd6000912cc00400a2600e606a01113259800800c566002605c60626ea8006264b3001001807c4c96600200301080840420211332259800800c04a264b3001001809c04e02713259800981e001c4c020c0f002602881c8dd6800c04d03c181c800a06e375c002607000481c8c0d800503418191baa0018072060807403a01d00e40dc6068004819201700b40d06eb8004c0b4009032181580098170012058802a0543756003004802401102d1815000a050302637540030024091002801400a0048158528981398121baa0018a504089164088603c60466ea8c06cc08cdd5000c528c52820468992cc004c07cc088dd500644cc8966002603460486ea8006264b3001302230253754003132598009815800c4c8cc07c004896600200515980099baf374c0066e9801e2b30013375e6e9c038dd39919800800994c0040060154bd6f7b630200222259800801440063300100398190014c9660026048605c6ea8006264b3001302c302f37540031323259800981b000c4cc88cc0ac0048966002005132329800800c017300100b80352000400880088896600200510018cc00400e607c0059800800cdd7181e801520004010801903b1111919800800802112cc00400626607a66ec0dd48021ba80034bd6f7b63044ca60026eb8c0ec0066eb4c0f000660800049112cc004cdc8004001c4cc104cdd81ba9008375000e00b15980099b8f00800389982099bb037520106ea001c00626608266ec0dd48019ba80023300600600140f481e8607c00281e2264600460760066eb8c0e40090371bae30350023758606a0031640cc606a00260606ea80062c8170c0c8c0bcdd5000c5902d181498171baa3026302e37546062004801902f112cc004006297ae089981718159817800998010011818000a05a8a518b20508b205089919198119bac302c002225980080144c014c0c801a26604060620042600260640048178dd7181500098168012056375660540031640a0604c6ea80062c8120c0a0c094dd5000c59023194c004c8cc004004dd5981418129baa30283025375401c44b30010018a5eb7bdb182265300133003003302b0029bae30260019bac302700140106052002813a6eb8c09cc090dd50084c8cc00400400c896600200314bd7044cc0a0c0a4c098dd51814800998010011815000a04e4004444646600200200844b300100189981519bb037520086e9c00d2f5bded8c113298009bae30280019bac302900198168012444b30013372001000713302e337606ea4020dd3803802c56600266e3c02000e26605c66ec0dd48041ba700700189981719bb037520066e9c008cc01801800502a20541815800a052301e30233754604c60466ea800e2c8108cc004dd618128049192cc004c064c08cdd5000c56600266ebcc068cc098dd4802a5eb80c09cc090dd5181398121baa301c302437540051332259800800c5660026044604a6ea8006264b3001001801c4c96600200300480240120091332259800800c01a264b3001001803c01e264b30013030003899811800912cc00400a2946264b3001001805c02e01700b8991801981a0021bae00140d06062004817a0108168dd6000c01e00e8180c0b400502b1bae001302c00240b460540028140c098dd5000c009024400a005002801205614a0604e60486ea80062941022459022180f18119baa301b3023375400316408044646600200200644b30010018a5eb8226644b3001300500289981480119802002000c4cc01001000502518140009814800a04c8b203e330103758604600a4603730013756603260426ea800600548810040486eb8c088c07cdd5000c5901d1810980f1baa3021301e3754602c603c6ea8c084c078dd5000c5901c1bac301f30203020302030203020302000133009002006301f002301d0013758603800260306ea802e2945016180b9baa00430190013019301a001301537540091598009808801c4c8cc89660026028602e6ea8cc014dd6180d80180fc566002602530013756603660386038005001a44100402513259800980a980c1baa0018992cc004cdd7980e980d1baa301d301a37540026020660386ea400d2f5c1132598009808180d1baa0018992cc004c060c06cdd5000c4c96600260420031323301500122598008014566002b30010038a518a50408514a316407913232330193758604400444b300100289802981400344cc058c09c0084c004c0a00090251bae3020001302300240846eacc0800062c80f0c070dd5000c5901a180f180d9baa0018b20323015301a3754003164060603860326ea80062c80b8cc020dd6180d80111809cc004dd59808980c9baa0018015221004029164059164058603460340026eb8c064c058dd5002980a9baa0088b2026404c30143015005229344d95900101",
        {
          "shape": {
            "dataType": "list",
            "items": [{
              "$ref": "#/definitions/cardano/transaction/OutputReference",
            }],
          },
          definitions,
        } as any,
      ),
    };
  },
  {
    _redeemer: {
      "shape": { "$ref": "#/definitions/cardano/transaction/Redeemer" },
      definitions,
    },
  },
) as unknown as AdhocLedgerV1LpV1Mint;

export interface AdhocLedgerV2LpV2Spend {
  new (): Script;
  _datumOpt: AdhocLedgerV2LpDatum;
  redeemer: AdhocLedgerV2LpSpendRedeemer;
}

export const AdhocLedgerV2LpV2Spend = Object.assign(
  function () {
    return {
      type: "PlutusV3",
      script:
        "59050601010029800aba2aba1aba0aab9faab9eaab9dab9a4888888966003300130033754011370e90014dd2a40012232330010010032259800800c400e2660126014002660040046016002804244646600200200644660060026004005230073008300800191111194c00400600d002802c0110011112cc00400a200313298008024c04000e4530010038014006008804100418070012018918039804000cdc3a400091111111119194c004c034dd5000c888c966002601c60226ea80062900044dd6980a98091baa001404064b3001300e3011375400314c0103d87a8000899198008009bab30163013375400444b30010018a6103d87a8000899192cc004cdc8803000c56600266e3c0180062602266030602c00497ae08a60103d87a80004051133004004301a00340506eb8c050004c05c005015202032330010010042259800800c5300103d87a8000899192cc004cdc8803000c56600266e3c018006260206602e602a00497ae08a60103d87a8000404d1330040043019003404c6eb8c04c004c0580050144c04402e602200491112cc004c038012264653001132332298009bab301a0029bac301a301b301b301b301b0029919800800801112cc0040062980103d87a80008992cc004cdd7980e980d1baa0010078980a9980e000a5eb82266006006603c00480c0c07000501a2444b3001300f3019375400313259800980b980d1baa0018992cc004c044c06cdd5005c528c6600200d4800297ae091112cc004cdd7981198101baa302330203754602c60406ea8010cdd2a4004660446ea40152f5c11325980099b8748010c080dd5000c4c966002602e60426ea800626464b30013028001899911980f800912cc00400a26601266e0002d20023302a3752008660440140071323002302d003375c60560048148dd718138011bac30270018b204a302700130223754003164080604860426ea80062c80f8c060c080dd5180b18101baa004899800801801203c912cc004cdc3cc00401e007488100403c66e0520000028acc004cdd79ba7006374e00314a3164071164070809901a1bae301e301b3754003164064603a60346ea8c074c068dd51808180d1baa301d301a375400316406030193019301930190013758603000260286ea801260266ea800e602e60300049112cc004c03000a2b30013017375400d0038b20308acc004c04c00a2b30013017375400d0038b20308b202a405430160013012375400b159800980380244c8cc89660026014003159800980a9baa00480145901645660026022003159800980a9baa0048014590164590132026159800980418091baa0028991919912cc004cdc424000003198009bac301a004a40014bd70488896600266ebcc078c06cdd5180f180d9baa0043374a90011980e9ba90094bd704566002602f30013756602260366ea80120134890040311325980099b8748010c06cdd5000c4c966002602460386ea800626464b30013023001899911980d000912cc00400a26601266e0002d20023301d00a003899180118140019bae302600240906eb8c088008dd61811000c590201811000980e9baa0018b2036301f301c3754003164068602660366ea80122c80ca26600200600480ca44b30013370e00600515980099baf374e0086e9c00629462c80ba2c80b900e4590151bac3018301930193019301900198009bab3018001801d220100401860306030002602e602e60266ea800e294501118091baa002375c602a60246ea80162c80810100c040c044004c040025149a26cac8009",
    };
  },
  {
    _datumOpt: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v2/LpDatum" },
      definitions,
    },
  },
  {
    redeemer: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v2/LpSpendRedeemer" },
      definitions,
    },
  },
) as unknown as AdhocLedgerV2LpV2Spend;

export interface AdhocLedgerV2LpV2Mint {
  new (): Script;
  redeemer: AdhocLedgerV2LpMintRedeemer;
}

export const AdhocLedgerV2LpV2Mint = Object.assign(
  function () {
    return {
      type: "PlutusV3",
      script:
        "59050601010029800aba2aba1aba0aab9faab9eaab9dab9a4888888966003300130033754011370e90014dd2a40012232330010010032259800800c400e2660126014002660040046016002804244646600200200644660060026004005230073008300800191111194c00400600d002802c0110011112cc00400a200313298008024c04000e4530010038014006008804100418070012018918039804000cdc3a400091111111119194c004c034dd5000c888c966002601c60226ea80062900044dd6980a98091baa001404064b3001300e3011375400314c0103d87a8000899198008009bab30163013375400444b30010018a6103d87a8000899192cc004cdc8803000c56600266e3c0180062602266030602c00497ae08a60103d87a80004051133004004301a00340506eb8c050004c05c005015202032330010010042259800800c5300103d87a8000899192cc004cdc8803000c56600266e3c018006260206602e602a00497ae08a60103d87a8000404d1330040043019003404c6eb8c04c004c0580050144c04402e602200491112cc004c038012264653001132332298009bab301a0029bac301a301b301b301b301b0029919800800801112cc0040062980103d87a80008992cc004cdd7980e980d1baa0010078980a9980e000a5eb82266006006603c00480c0c07000501a2444b3001300f3019375400313259800980b980d1baa0018992cc004c044c06cdd5005c528c6600200d4800297ae091112cc004cdd7981198101baa302330203754602c60406ea8010cdd2a4004660446ea40152f5c11325980099b8748010c080dd5000c4c966002602e60426ea800626464b30013028001899911980f800912cc00400a26601266e0002d20023302a3752008660440140071323002302d003375c60560048148dd718138011bac30270018b204a302700130223754003164080604860426ea80062c80f8c060c080dd5180b18101baa004899800801801203c912cc004cdc3cc00401e007488100403c66e0520000028acc004cdd79ba7006374e00314a3164071164070809901a1bae301e301b3754003164064603a60346ea8c074c068dd51808180d1baa301d301a375400316406030193019301930190013758603000260286ea801260266ea800e602e60300049112cc004c03000a2b30013017375400d0038b20308acc004c04c00a2b30013017375400d0038b20308b202a405430160013012375400b159800980380244c8cc89660026014003159800980a9baa00480145901645660026022003159800980a9baa0048014590164590132026159800980418091baa0028991919912cc004cdc424000003198009bac301a004a40014bd70488896600266ebcc078c06cdd5180f180d9baa0043374a90011980e9ba90094bd704566002602f30013756602260366ea80120134890040311325980099b8748010c06cdd5000c4c966002602460386ea800626464b30013023001899911980d000912cc00400a26601266e0002d20023301d00a003899180118140019bae302600240906eb8c088008dd61811000c590201811000980e9baa0018b2036301f301c3754003164068602660366ea80122c80ca26600200600480ca44b30013370e00600515980099baf374e0086e9c00629462c80ba2c80b900e4590151bac3018301930193019301900198009bab3018001801d220100401860306030002602e602e60266ea800e294501118091baa002375c602a60246ea80162c80810100c040c044004c040025149a26cac8009",
    };
  },
  {
    redeemer: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v2/LpMintRedeemer" },
      definitions,
    },
  },
) as unknown as AdhocLedgerV2LpV2Mint;

export interface AdhocLedgerV4VerifiedSpend {
  new (): Script;
  datumOpt: AdhocLedgerV4VerifiedDatum;
  redeemer: AdhocLedgerV4VerifiedRedeemer;
}

export const AdhocLedgerV4VerifiedSpend = Object.assign(
  function () {
    return {
      type: "PlutusV3",
      script:
        "589901010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cc01c0092225980099b8748008c01cdd500144ca60026016003300b300c00198041baa0048a51488896600266e1d20000028acc004c034dd500440062c80722b30013370e90010014566002601a6ea802200316403916402c805860106ea800a2c8030600e00260066ea801e29344d95900101",
    };
  },
  {
    datumOpt: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v4/VerifiedDatum" },
      definitions,
    },
  },
  {
    redeemer: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v4/VerifiedRedeemer" },
      definitions,
    },
  },
) as unknown as AdhocLedgerV4VerifiedSpend;

export interface AdhocLedgerV4WrappedSpend {
  new (): Script;
  datumOpt: AdhocLedgerV4WrappedDatum;
  redeemer: AdhocLedgerV4WrappedRedeemer;
}

export const AdhocLedgerV4WrappedSpend = Object.assign(
  function () {
    return {
      type: "PlutusV3",
      script:
        "58da01010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cc01c0092225980099b8748008c01cdd500144c8cc8a60022b30013001300a37540051332259800980198061baa0088a518a51402c601a60166ea8008dd618069807180718071807180718071807180718059baa0048b201298051baa0069806801a444b300130040028acc004c038dd5004c00e2c807a2b30013370e90010014566002601c6ea802600716403d1640308060601660180026e1d20003008375400516401830070013003375400f149a26cac8009",
    };
  },
  {
    datumOpt: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v4/WrappedDatum" },
      definitions,
    },
  },
  {
    redeemer: {
      "shape": { "$ref": "#/definitions/adhoc_ledger_v4/WrappedRedeemer" },
      definitions,
    },
  },
) as unknown as AdhocLedgerV4WrappedSpend;

export interface HtlcHtlcSpend {
  new (): Script;
  datumOpt: HtlcHtlcDatum;
  redeemer: HtlcRedeemer;
}

export const HtlcHtlcSpend = Object.assign(
  function () {
    return {
      type: "PlutusV3",
      script:
        "5903e601010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cdc3a400530080024888966002600460106ea800e26466453001159800980098059baa0028cc004c040c040c030dd50024c030dd5180798061baa002911919800800801912cc00400629422b30013371e6eb8c04c00400e29462660040046028002807101148c040c044005222233229800980a8014dd6180a980b0014c0580066eb4c05400522223232598009806980b9baa0138acc004cdc79b94375c603660306ea804cdd7180d805c56600264b3001301230183754003132598009809980c9baa300b301a3754601660346ea8022266e20004016266e240040150181bad301c3019375400314a080b8c06cc060dd51804980c1baa0068acc004cc028014dd7180d80144c8c8cc004004dd6180e807112cc00400629422b3001325980099baf301f301c3754002603e60386ea80162b300132598009809180e1baa001899baf3005301d375400466e9520043301f3020301d375400297ae0899baf3005301d375400498103d8798000406c600860386ea8016266ebcc034c070dd50009ba632330010013756601c603a6ea8018896600200314bd6f7b63044c8c8cc88cc88cc0080080048966002003133026337606ea400cdd300225eb7bdb1822653001375c60480033756604a003302900248896600266e4001c00e26605466ec0dd48039ba60080058acc004cdc7803801c4c966002603c60506ea800626605666ec0dd4804181618149baa0010028801204e689981519bb037520066e98008cc018018005026204c1813800a04a330060063026005323200332330010010032259800800c5268992cc0040062b30013004375a6048604e005149a2c811226644b3001337206eb8c094008dd71812800c566002600c6eb4c09800a26600a00a660500026054007164091164090604e004604e0028128c09c00502414c004c05800694294501f1bae301f0023756603e002604200280fa294101a45282034301e0018a51899801001180f800a032407046038603a603a00314a080b229410164528202c8acc004c966002602460306ea8006264b3001301330193754601660346ea8c074c068dd500444cdc4002800c4cdc4802800a030375a603860326ea80062941017180d980c1baa301b3018375400d13300a005375c603600914a080b1016180d180d800980d0010c050c050c050c050c050010c05000d164029300b375400f300f00348896600260080051323259800980a80140162c8090dd7180980098079baa00a8acc004c02000a2b3001300f37540150038b20208b201a4034300d300e001370e900018049baa0038b200e180400098019baa0088a4d13656400401",
    };
  },
  {
    datumOpt: {
      "shape": { "$ref": "#/definitions/htlc/HtlcDatum" },
      definitions,
    },
  },
  {
    redeemer: {
      "shape": { "$ref": "#/definitions/htlc/Redeemer" },
      definitions,
    },
  },
) as unknown as HtlcHtlcSpend;

export interface VestingVestingSpend {
  new (): Script;
  datumOpt: VestingVestingDatum;
  _redeemer: Data;
}

export const VestingVestingSpend = Object.assign(
  function () {
    return {
      type: "PlutusV3",
      script:
        "59013b01010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cdc3a400530070024888966002600460106ea800e2646644b30013370e900018059baa001899912cc004c8cc8966002601460206ea800a264b3001300b30113754600a60246ea8c050c048dd500244cdc4001000c4cdc4801000a020375a602660226ea800a294100f180898079baa3011300f37540026eb4c044c03cdd50019808180898089808980898089808980898071baa00689919198008009bac3012301330133013301330133013301330133010375401044b30010018a508acc004cdc79bae30130010038a51899801001180a000a01e40486eb8c004c038dd500145282018300e300c37540024601e602000316402860180026018601a00260126ea800e2c8038600e00260066ea801e29344d9590011",
    };
  },
  {
    datumOpt: {
      "shape": { "$ref": "#/definitions/vesting/VestingDatum" },
      definitions,
    },
  },
  { _redeemer: { "shape": { "$ref": "#/definitions/Data" }, definitions } },
) as unknown as VestingVestingSpend;
