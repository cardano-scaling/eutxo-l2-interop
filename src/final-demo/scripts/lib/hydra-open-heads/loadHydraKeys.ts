import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Participant } from "./types";
import { credentialsRoot, infraCredentialsRoot } from "./config";

export async function loadHydraVkeyHex(name: Participant["name"]): Promise<string> {
  const localPath = join(credentialsRoot, name, `${name}-hydra.vk`);

  const fallbackByName: Record<string, string> = {
    bob: "481d32bbc38419d351cd92443617958a1222b2f52f0917a2b591bfadba95eabc",
    ida: "8d81e8ef3ce48267ae661a80c8e4fcaf25922a2e4b4248ce253202d546c8f034",
    jon: "2f0c14345a46a8bdd29d2640cee928181bb4e51b4037944f472c10671be7ad6c",
    alice: "a97b927ace3fad7558ec70e4cddc3b5b30aab7ed92055a3e1deca392",
    charlie: "71377249b9e3868b7b42a92092e547bae9308fcfb7045e2f3ab0562c",
  };

  const readKeyFile = async (path: string): Promise<string> => {
    const raw = JSON.parse(await readFile(path, "utf8")) as { cborHex?: string };
    const cborHex = (raw.cborHex ?? "").trim().toLowerCase();
    if (!cborHex.startsWith("5820") || cborHex.length !== 4 + 64) {
      throw new Error(`Invalid hydra vk cborHex for ${name}: ${cborHex.slice(0, 20)}`);
    }
    return cborHex.slice(4);
  };

  if (existsSync(localPath)) {
    return await readKeyFile(localPath);
  }

  const infraPath = join(infraCredentialsRoot, name, `${name}-hydra.vk`);
  if (existsSync(infraPath)) {
    return await readKeyFile(infraPath);
  }

  const fallback = fallbackByName[name];
  if (fallback) return fallback;

  throw new Error(`Missing hydra vkey for ${name} (no ${localPath}, no ${infraPath}, and no fallback mapping)`);
}
