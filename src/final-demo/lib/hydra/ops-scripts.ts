import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyParamsToScript, validatorToScriptHash } from "@lucid-evolution/lucid";

type PlutusJson = {
  validators: Array<{
    title: string;
    compiledCode: string;
    hash: string;
  }>;
};

function loadPlutusJson(): PlutusJson {
  const raw = readFileSync(join(process.cwd(), "../onchain/plutus.json"), "utf8");
  return JSON.parse(raw) as PlutusJson;
}

function findValidator(
  plutusJson: PlutusJson,
  filename: string,
  scriptName: string,
  purpose: string,
): { compiledCode: string; hash: string } {
  const title = `${filename}.${scriptName}.${purpose}`;
  const validator = plutusJson.validators.find((v) => v.title === title);
  if (!validator) {
    throw new Error(`Validator ${title} not found in plutus.json`);
  }
  return {
    compiledCode: validator.compiledCode,
    hash: validator.hash,
  };
}

export function getLotteryScriptInfo() {
  const plutus = loadPlutusJson();
  return findValidator(plutus, "lottery", "lottery", "spend");
}

export function getLotteryMintScriptInfo() {
  const plutus = loadPlutusJson();
  return findValidator(plutus, "lottery", "lottery", "mint");
}

export function getParameterizedTicketScriptInfo(lotteryScriptHash: string) {
  const plutus = loadPlutusJson();
  const raw = findValidator(plutus, "lottery", "ticket", "spend");
  const compiledCode = applyParamsToScript(raw.compiledCode, [lotteryScriptHash]);
  const hash = validatorToScriptHash({ type: "PlutusV3", script: compiledCode });
  return {
    compiledCode,
    hash,
  };
}
