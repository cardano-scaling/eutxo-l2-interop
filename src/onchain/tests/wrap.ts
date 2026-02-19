import {
  Addresses,
  type Assets,
  Crypto,
  Data,
  Lucid,
  type Provider,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
} from "./plutus.ts";
import { HydraEmulator } from "./hydra_emulator.ts";
import { HydraHandler } from "./hydra_handler.ts";
import { HydraNodeProvider } from "./hydra_node_provider.ts";

// ============================================================
// Configuration
// ============================================================

const CREDENTIALS_PATH = "./infra/credentials";

// Hydra node API endpoints (must match docker-compose)
const HEAD_A_API = "http://127.0.0.1:4011"; // Alice's node in Head A
const HEAD_B_API = "http://127.0.0.1:4022"; // Bob's node in Head B

// ============================================================
// Shared environment interface (both setup functions satisfy this)
// ============================================================

export interface WrapEnvironment {
  privateKey1: string; // Alice
  privateKey2: string; // Ida
  privateKey3: string; // Bob
  address1: string;
  address2: string;
  address3: string;
  alice: { address: string; assets: Assets };
  ida: { address: string; assets: Assets };
  bob: { address: string; assets: Assets };
  emulatorA: Provider; // Head A provider
  emulatorB: Provider; // Head B provider
  lucid1A: Lucid; // Alice in Head A
  lucid2B: Lucid; // Ida in Head B
}

// ============================================================
// Emulator setup (original logic, renamed)
// ============================================================

export function setupHydraEmulatorEnvironment() {
  // ALICE
  const privateKey1 = Crypto.generatePrivateKey();
  const address1 = Addresses.credentialToAddress(
    { Emulator: 0 },
    Crypto.privateKeyToDetails(privateKey1).credential,
  );
  const alice = {
    address: address1,
    assets: { lovelace: 3000000000n },
  };

  // IDA
  const privateKey2 = Crypto.generatePrivateKey();
  const address2 = Addresses.credentialToAddress(
    { Emulator: 0 },
    Crypto.privateKeyToDetails(privateKey2).credential,
  );
  const ida = {
    address: address2,
    assets: { lovelace: 3000000000n },
  };

  // BOB
  const privateKey3 = Crypto.generatePrivateKey();
  const address3 = Addresses.credentialToAddress(
    { Emulator: 0 },
    Crypto.privateKeyToDetails(privateKey3).credential,
  );
  const bob = {
    address: address3,
    assets: { lovelace: 3000000000n },
  };

  // SETUP EMULATORS FOR HYDRA HEADS A AND B
  const emulatorA = HydraEmulator.withAccounts([alice, ida]);
  const emulatorB = HydraEmulator.withAccounts([ida, bob]);

  // ALICE'S LUCID INSTANCE IN HEAD A
  const lucid1A = new Lucid({
    provider: emulatorA,
    wallet: { PrivateKey: privateKey1 },
  });

  // IDA'S LUCID INSTANCE IN HEAD B
  const lucid2B = new Lucid({
    provider: emulatorB,
    wallet: { PrivateKey: privateKey2 },
  });

  return {
    privateKey1,
    privateKey2,
    privateKey3,
    address1,
    address2,
    address3,
    alice,
    ida,
    bob,
    emulatorA,
    emulatorB,
    lucid1A,
    lucid2B,
  };
}

// Backward-compatible alias — existing imports continue to work
export { setupHydraEmulatorEnvironment as setupWrapEnvironment };

// ============================================================
// Hydra nodes setup (connects to real Hydra heads)
// ============================================================

/** Load a Cardano .sk file and return the raw ed25519 hex (32 bytes). */
async function loadPrivateKeyHex(skPath: string): Promise<string> {
  const skJson = JSON.parse(await Deno.readTextFile(skPath));
  return skJson.cborHex.slice(4); // skip CBOR prefix 5820
}

export async function setupHydraNodesEnvironment(): Promise<WrapEnvironment> {
  // ── Load credentials from files ──────────────────────────
  const privateKey1 = await loadPrivateKeyHex(
    `${CREDENTIALS_PATH}/alice/alice-funds.sk`,
  );
  const privateKey2 = await loadPrivateKeyHex(
    `${CREDENTIALS_PATH}/ida/ida-funds.sk`,
  );
  const privateKey3 = await loadPrivateKeyHex(
    `${CREDENTIALS_PATH}/bob/bob-funds.sk`,
  );

  const address1 = (
    await Deno.readTextFile(`${CREDENTIALS_PATH}/alice/alice-funds.addr`)
  ).trim();
  const address2 = (
    await Deno.readTextFile(`${CREDENTIALS_PATH}/ida/ida-funds.addr`)
  ).trim();
  const address3 = (
    await Deno.readTextFile(`${CREDENTIALS_PATH}/bob/bob-funds.addr`)
  ).trim();

  // ── Connect to Hydra heads ───────────────────────────────
  const handlerA = new HydraHandler(HEAD_A_API);
  const handlerB = new HydraHandler(HEAD_B_API);

  // Wait for WebSocket connections
  await new Promise((r) => setTimeout(r, 1000));

  // Verify heads are open
  const statusA = await handlerA.getHeadStatus();
  if (statusA !== "Open") {
    throw new Error(
      `Head A is not open (status: ${statusA}). Run commit.ts first.`,
    );
  }
  const statusB = await handlerB.getHeadStatus();
  if (statusB !== "Open") {
    throw new Error(
      `Head B is not open (status: ${statusB}). Run commit.ts first.`,
    );
  }

  // ── Create providers ─────────────────────────────────────
  const emulatorA = new HydraNodeProvider(handlerA);
  const emulatorB = new HydraNodeProvider(handlerB);

  // ── Query snapshots for account balances ─────────────────
  const snapshotA = await handlerA.getSnapshot();
  const snapshotB = await handlerB.getSnapshot();

  const aliceLovelace = snapshotA
    .filter((u) => u.address === address1)
    .reduce((sum, u) => sum + (u.assets.lovelace ?? 0n), 0n);
  const idaLovelaceA = snapshotA
    .filter((u) => u.address === address2)
    .reduce((sum, u) => sum + (u.assets.lovelace ?? 0n), 0n);
  const bobLovelace = snapshotB
    .filter((u) => u.address === address3)
    .reduce((sum, u) => sum + (u.assets.lovelace ?? 0n), 0n);

  const alice = { address: address1, assets: { lovelace: aliceLovelace } };
  const ida = { address: address2, assets: { lovelace: idaLovelaceA } };
  const bob = { address: address3, assets: { lovelace: bobLovelace } };

  console.log(
    `  Alice: ${aliceLovelace / 1_000_000n} ADA in Head A`,
  );
  console.log(
    `  Ida:   ${idaLovelaceA / 1_000_000n} ADA in Head A`,
  );
  console.log(
    `  Bob:   ${bobLovelace / 1_000_000n} ADA in Head B`,
  );

  // ── Create Lucid instances ───────────────────────────────
  // Alice in Head A
  const lucid1A = new Lucid({
    provider: emulatorA,
    wallet: { PrivateKey: privateKey1 },
  });

  // Ida in Head B
  const lucid2B = new Lucid({
    provider: emulatorB,
    wallet: { PrivateKey: privateKey2 },
  });

  return {
    privateKey1,
    privateKey2,
    privateKey3,
    address1,
    address2,
    address3,
    alice,
    ida,
    bob,
    emulatorA,
    emulatorB,
    lucid1A,
    lucid2B,
  };
}

// ============================================================
// Wrap transaction logic (works with both emulator and real nodes)
// ============================================================

export async function performWrapTransactions(
  lucid1A: Lucid,
  lucid2B: Lucid,
  privateKey1: any,
  privateKey2: any,
  emulatorA: Provider,
  emulatorB: Provider,
) {
  const wrappedValidator = new AdhocLedgerV4WrappedSpend();
  const wrappedAddress = lucid1A.newScript(wrappedValidator).toAddress();

  // WRAP UTXO IN A: Alice wraps 5 ADA in head A
  const wrappedDatum: AdhocLedgerV4WrappedDatum = {
    owner: Crypto.privateKeyToDetails(privateKey1).credential.hash, // Alice address hash
    intermediaries: new Map([
      [Crypto.privateKeyToDetails(privateKey2).credential.hash, 5_000_000n],
    ]), // Ida as intermediary with 5 ADA
    nonce: { transactionId: "", outputIndex: 0n }, // Empty nonce for now
    disputed: false, // Not disputed initially
    timeout: 1000000n, // Set a timeout slot
  };
  const wrapTxA = await lucid1A
    .newTx()
    .payToContract(
      wrappedAddress,
      { Inline: Data.to(wrappedDatum, AdhocLedgerV4WrappedSpend.datumOpt) },
      { lovelace: 5000000n },
    )
    .commit();
  const signedWrapTxA = await wrapTxA.sign().commit();
  const wrapTxAHash = await signedWrapTxA.submit();
  await emulatorA.awaitTx(wrapTxAHash);
  console.log("WRAP TX A:", wrapTxAHash);

  // WRAP UTXO IN B: Ida wraps 5 ADA in head B on behalf of Alice
  const wrappedDatumB: AdhocLedgerV4WrappedDatum = {
    owner: Crypto.privateKeyToDetails(privateKey2).credential.hash, // Ida address hash
    intermediaries: new Map([
      [Crypto.privateKeyToDetails(privateKey1).credential.hash, 5_000_000n],
    ]), // Alice as intermediary with 5 ADA
    nonce: { transactionId: "", outputIndex: 0n }, // Empty nonce for now
    disputed: false, // Not disputed initially
    timeout: 1000000n, // Set a timeout slot
  };
  const wrapTxB = await lucid2B
    .newTx()
    .payToContract(
      wrappedAddress,
      { Inline: Data.to(wrappedDatumB, AdhocLedgerV4WrappedSpend.datumOpt) },
      { lovelace: 5000000n },
    )
    .commit();
  const signedWrapTxB = await wrapTxB.sign().commit();
  const wrapTxBHash = await signedWrapTxB.submit();
  await emulatorB.awaitTx(wrapTxBHash);
  console.log("WRAP TX B:", wrapTxBHash);

  return { wrappedValidator, wrappedAddress, wrappedDatum, wrappedDatumB };
}

// ============================================================
// Assertions (emulator-only) — verify wrap produced expected UTXOs
// ============================================================

export async function assertWrapResults(
  lucid1A: Lucid,
  lucid2B: Lucid,
  privateKey1: string,
  privateKey2: string,
  wrappedAddress: string,
) {
  const scriptUtxosA = await lucid1A.utxosAt(wrappedAddress);
  const scriptUtxosB = await lucid2B.utxosAt(wrappedAddress);

  if (scriptUtxosA.length !== 1) {
    throw new Error(`Expected 1 wrapped UTXO in Head A, found ${scriptUtxosA.length}`);
  }
  if (scriptUtxosB.length !== 1) {
    throw new Error(`Expected 1 wrapped UTXO in Head B, found ${scriptUtxosB.length}`);
  }
  if (scriptUtxosA[0].assets.lovelace !== 5_000_000n) {
    throw new Error(`Head A wrapped UTXO has ${scriptUtxosA[0].assets.lovelace} lovelace, expected 5000000`);
  }
  if (scriptUtxosB[0].assets.lovelace !== 5_000_000n) {
    throw new Error(`Head B wrapped UTXO has ${scriptUtxosB[0].assets.lovelace} lovelace, expected 5000000`);
  }

  // Verify datums: both must be non-disputed with correct owners
  const datumA = Data.from(scriptUtxosA[0].datum!, AdhocLedgerV4WrappedSpend.datumOpt);
  const datumB = Data.from(scriptUtxosB[0].datum!, AdhocLedgerV4WrappedSpend.datumOpt);
  const aliceHash = Crypto.privateKeyToDetails(privateKey1).credential.hash;
  const idaHash = Crypto.privateKeyToDetails(privateKey2).credential.hash;

  if (datumA.owner !== aliceHash) {
    throw new Error(`Head A datum owner mismatch: expected Alice (${aliceHash}), got ${datumA.owner}`);
  }
  if (datumB.owner !== idaHash) {
    throw new Error(`Head B datum owner mismatch: expected Ida (${idaHash}), got ${datumB.owner}`);
  }
  if (datumA.disputed || datumB.disputed) {
    throw new Error("Freshly wrapped UTXOs should not be disputed");
  }

  console.log("✅ Assertions passed: 1 wrapped UTXO per head, 5 ADA each, correct owners, not disputed");
}

// ============================================================
// Main — run with: deno run --allow-net --allow-read wrap.ts [--mode=nodes]
// ============================================================

if (import.meta.main) {
  const mode = Deno.args.includes("--mode=nodes") ? "nodes" : "emulator";
  if (mode === "nodes") {
    try { await Deno.stat("./infra/l1-utxos.ready"); }
    catch { console.error("Infrastructure not ready — l1-utxos.ready not found. Is docker compose up?"); Deno.exit(1); }
  }
  console.log(`Running wrap.ts in ${mode} mode...`);

  const env =
    mode === "nodes"
      ? await setupHydraNodesEnvironment()
      : setupHydraEmulatorEnvironment();

  // ── Show snapshots BEFORE wrap (nodes only) ──────────────
  if (mode === "nodes") {
    const handlerA = (env.emulatorA as HydraNodeProvider).getHandler();
    const handlerB = (env.emulatorB as HydraNodeProvider).getHandler();

    // Build address → name lookup
    const wrappedAddr = new Lucid({ provider: env.emulatorA, wallet: { PrivateKey: env.privateKey1 } })
      .newScript(new AdhocLedgerV4WrappedSpend()).toAddress();
    const addrNames: Record<string, string> = {
      [env.address1]: "alice",
      [env.address2]: "ida",
      [env.address3]: "bob",
      [wrappedAddr]: "validator",
    };
    const label = (addr: string) => addrNames[addr] ?? addr.slice(0, 30) + "…";
    const logUtxo = (u: { txHash: string; outputIndex: number; assets: Assets; address: string }) =>
      console.log(`  ${u.txHash}#${u.outputIndex}: ${u.assets.lovelace} lovelace  [${label(u.address)}]`);

    console.log("\n--- Head A snapshot BEFORE wrap ---");
    const snapA0 = await handlerA.getSnapshot();
    for (const u of snapA0) logUtxo(u);
    if (snapA0.length === 0) console.log("  (empty)");

    console.log("\n--- Head B snapshot BEFORE wrap ---");
    const snapB0 = await handlerB.getSnapshot();
    for (const u of snapB0) logUtxo(u);
    if (snapB0.length === 0) console.log("  (empty)");
    console.log("");
  }

  const { wrappedAddress } = await performWrapTransactions(
    env.lucid1A,
    env.lucid2B,
    env.privateKey1,
    env.privateKey2,
    env.emulatorA,
    env.emulatorB,
  );

  console.log("Wrap transactions completed successfully!");

  // ── Emulator-only assertions ──────────────────────────────
  if (mode === "emulator") {
    await assertWrapResults(env.lucid1A, env.lucid2B, env.privateKey1, env.privateKey2, wrappedAddress);
  }

  // ── Show snapshots AFTER wrap (nodes only) ───────────────
  if (mode === "nodes") {
    const handlerA = (env.emulatorA as HydraNodeProvider).getHandler();
    const handlerB = (env.emulatorB as HydraNodeProvider).getHandler();

    const wrappedAddr = new Lucid({ provider: env.emulatorA, wallet: { PrivateKey: env.privateKey1 } })
      .newScript(new AdhocLedgerV4WrappedSpend()).toAddress();
    const addrNames: Record<string, string> = {
      [env.address1]: "alice",
      [env.address2]: "ida",
      [env.address3]: "bob",
      [wrappedAddr]: "validator",
    };
    const label = (addr: string) => addrNames[addr] ?? addr.slice(0, 30) + "…";
    const logUtxo = (u: { txHash: string; outputIndex: number; assets: Assets; address: string }) =>
      console.log(`  ${u.txHash}#${u.outputIndex}: ${u.assets.lovelace} lovelace  [${label(u.address)}]`);

    console.log("\n--- Head A snapshot AFTER wrap ---");
    const snapA1 = await handlerA.getSnapshot();
    for (const u of snapA1) logUtxo(u);
    if (snapA1.length === 0) console.log("  (empty)");

    console.log("\n--- Head B snapshot AFTER wrap ---");
    const snapB1 = await handlerB.getSnapshot();
    for (const u of snapB1) logUtxo(u);
    if (snapB1.length === 0) console.log("  (empty)");

    handlerA.stop();
    handlerB.stop();
  }
} else {
  console.log("wrap.ts imported as module");
}
