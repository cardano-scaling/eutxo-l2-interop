import {
  Addresses,
  type Assets,
  Crypto,
  Data,
  Emulator,
  Lucid,
  type Script,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
  CardanoTransactionOutputReference
} from "./plutus.ts";

// Import reusable functions from wrap.ts
import {
  setupWrapEnvironment,
  setupHydraNodesEnvironment,
  performWrapTransactions,
  type WrapEnvironment,
} from "./wrap.ts";
import { HydraNodeProvider } from "./hydra_node_provider.ts";

// Main dispute test
async function main() {
  // Setup environment using imported function
  const env = setupWrapEnvironment();

  // Perform wrap transactions using imported function
  const { wrappedValidator, wrappedAddress, wrappedDatum, wrappedDatumB } = await performWrapTransactions(
    env.lucid1A, env.lucid2B, env.privateKey1, env.privateKey2, env.emulatorA, env.emulatorB
  );

  //
  // DISPUTE UTXO IN A: Alice disputes her 5 ADA from head A
  //
  const wrappedUtxosA = await env.lucid1A.utxosAt(wrappedAddress);
  if (wrappedUtxosA.length === 0) {
    throw new Error("No wrapped UTXOs found in head A");
  }

  // Create updated datum with disputed = true for the dispute transaction
  const disputedDatumA: AdhocLedgerV4WrappedDatum = {
    ...wrappedDatum,
    disputed: true,
    timeout: 1000000n,
  };

  const disputeTxA = await env.lucid1A.newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey1).credential.hash)
    .collectFrom(wrappedUtxosA, Data.to("Dispute", AdhocLedgerV4WrappedSpend.redeemer))
    .payToContract(wrappedAddress, { Inline: Data.to(disputedDatumA, AdhocLedgerV4WrappedSpend.datumOpt) }, { lovelace: 5000000n })
    .attachScript(wrappedValidator)
    .commit();
  const signedDisputeTxA = await disputeTxA.sign().commit();
  const disputeTxAHash = await signedDisputeTxA.submit();
  env.emulatorA.awaitTx(disputeTxAHash);
  console.log("DISPUTE TX A:", disputeTxAHash);

  //
  // DISPUTE UTXO IN B: Ida disputes 5 ADA from head B and sends to Alice
  //
  const wrappedUtxosB = await env.lucid2B.utxosAt(wrappedAddress);
  if (wrappedUtxosB.length === 0) {
    throw new Error("No wrapped UTXOs found in head B");
  }

  // Create updated datum with disputed = true for the dispute transaction
  const disputedDatumB: AdhocLedgerV4WrappedDatum = {
    ...wrappedDatumB!,
    disputed: true,
    timeout: 1000000n,
  };

  const disputeTxB = await env.lucid2B.newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey2).credential.hash)
    .collectFrom(wrappedUtxosB, Data.to("Dispute", AdhocLedgerV4WrappedSpend.redeemer))
    .payToContract(wrappedAddress, { Inline: Data.to(disputedDatumB, AdhocLedgerV4WrappedSpend.datumOpt) }, { lovelace: 5000000n })
    .attachScript(wrappedValidator)
    .commit();
  const signedDisputeTxB = await disputeTxB.sign().commit();
  const disputeTxBHash = await signedDisputeTxB.submit();
  env.emulatorB.awaitTx(disputeTxBHash);
  console.log("DISPUTE TX B:", disputeTxBHash);

  //
  // Check final balances to ensure disputeping worked correctly
  //
  const finalAliceBalanceA = await env.lucid1A.wallet.getUtxos();
  const finalAliceBalanceInA = finalAliceBalanceA.reduce((acc, utxo) =>
    acc + utxo.assets.lovelace, 0n);

  const finalIdaBalanceB = await env.lucid2B.wallet.getUtxos();
  const finalIdaBalanceInB = finalIdaBalanceB.reduce((acc, utxo) =>
    acc + utxo.assets.lovelace, 0n);

  console.log("Alice's final balance in head A:", finalAliceBalanceInA.toString());
  console.log("Ida's final balance in head B:", finalIdaBalanceInB.toString());

  // ── Emulator-only assertions ──────────────────────────────
  await assertDisputeResults(env.lucid1A, env.lucid2B, env.privateKey1, env.privateKey2, wrappedAddress);
}

// ============================================================
// Dispute transaction logic (works with both emulator and real nodes)
// ============================================================

export async function performDisputeTransactions(
  env: WrapEnvironment,
  wrappedValidator: Script,
  wrappedAddress: string,
  wrappedDatumA: AdhocLedgerV4WrappedDatum,
  wrappedDatumB: AdhocLedgerV4WrappedDatum,
) {
  //
  // DISPUTE UTXO IN A: Alice disputes her 5 ADA from head A
  //
  const wrappedUtxosA = await env.lucid1A.utxosAt(wrappedAddress);
  if (wrappedUtxosA.length === 0) {
    throw new Error("No wrapped UTXOs found in head A");
  }

  const disputedDatumA: AdhocLedgerV4WrappedDatum = {
    ...wrappedDatumA,
    disputed: true,
    timeout: 1000000n,
  };

  const disputeTxA = await env.lucid1A
    .newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey1).credential.hash)
    .collectFrom(
      wrappedUtxosA,
      Data.to("Dispute", AdhocLedgerV4WrappedSpend.redeemer),
    )
    .payToContract(
      wrappedAddress,
      {
        Inline: Data.to(
          disputedDatumA,
          AdhocLedgerV4WrappedSpend.datumOpt,
        ),
      },
      { lovelace: 5000000n },
    )
    .attachScript(wrappedValidator)
    .commit();
  const signedDisputeTxA = await disputeTxA.sign().commit();
  const disputeTxAHash = await signedDisputeTxA.submit();
  await env.emulatorA.awaitTx(disputeTxAHash);
  console.log("DISPUTE TX A:", disputeTxAHash);

  //
  // DISPUTE UTXO IN B: Ida disputes 5 ADA from head B
  //
  const wrappedUtxosB = await env.lucid2B.utxosAt(wrappedAddress);
  if (wrappedUtxosB.length === 0) {
    throw new Error("No wrapped UTXOs found in head B");
  }

  const disputedDatumB: AdhocLedgerV4WrappedDatum = {
    ...wrappedDatumB,
    disputed: true,
    timeout: 1000000n,
  };

  const disputeTxB = await env.lucid2B
    .newTx()
    .addSigner(Crypto.privateKeyToDetails(env.privateKey2).credential.hash)
    .collectFrom(
      wrappedUtxosB,
      Data.to("Dispute", AdhocLedgerV4WrappedSpend.redeemer),
    )
    .payToContract(
      wrappedAddress,
      {
        Inline: Data.to(
          disputedDatumB,
          AdhocLedgerV4WrappedSpend.datumOpt,
        ),
      },
      { lovelace: 5000000n },
    )
    .attachScript(wrappedValidator)
    .commit();
  const signedDisputeTxB = await disputeTxB.sign().commit();
  const disputeTxBHash = await signedDisputeTxB.submit();
  await env.emulatorB.awaitTx(disputeTxBHash);
  console.log("DISPUTE TX B:", disputeTxBHash);

  return { disputeTxAHash, disputeTxBHash };
}

// ============================================================
// Assertions (emulator-only) — verify dispute produced expected UTXOs
// ============================================================

export async function assertDisputeResults(
  lucid1A: Lucid,
  lucid2B: Lucid,
  privateKey1: string,
  privateKey2: string,
  wrappedAddress: string,
) {
  const scriptUtxosA = await lucid1A.utxosAt(wrappedAddress);
  const scriptUtxosB = await lucid2B.utxosAt(wrappedAddress);

  if (scriptUtxosA.length !== 1) {
    throw new Error(`Expected 1 disputed UTXO in Head A, found ${scriptUtxosA.length}`);
  }
  if (scriptUtxosB.length !== 1) {
    throw new Error(`Expected 1 disputed UTXO in Head B, found ${scriptUtxosB.length}`);
  }
  if (scriptUtxosA[0].assets.lovelace !== 5_000_000n) {
    throw new Error(`Head A disputed UTXO has ${scriptUtxosA[0].assets.lovelace} lovelace, expected 5000000`);
  }
  if (scriptUtxosB[0].assets.lovelace !== 5_000_000n) {
    throw new Error(`Head B disputed UTXO has ${scriptUtxosB[0].assets.lovelace} lovelace, expected 5000000`);
  }

  const datumA = Data.from(scriptUtxosA[0].datum!, AdhocLedgerV4WrappedSpend.datumOpt);
  const datumB = Data.from(scriptUtxosB[0].datum!, AdhocLedgerV4WrappedSpend.datumOpt);
  const aliceHash = Crypto.privateKeyToDetails(privateKey1).credential.hash;
  const idaHash = Crypto.privateKeyToDetails(privateKey2).credential.hash;

  if (!datumA.disputed) {
    throw new Error("Head A UTXO should be disputed");
  }
  if (!datumB.disputed) {
    throw new Error("Head B UTXO should be disputed");
  }
  if (datumA.owner !== aliceHash) {
    throw new Error(`Head A disputed datum owner mismatch: expected Alice (${aliceHash}), got ${datumA.owner}`);
  }
  if (datumB.owner !== idaHash) {
    throw new Error(`Head B disputed datum owner mismatch: expected Ida (${idaHash}), got ${datumB.owner}`);
  }

  console.log("✅ Assertions passed: 1 disputed UTXO per head, 5 ADA each, disputed=true, correct owners");
}

// ============================================================
// Main — run with: deno run --allow-net --allow-read dispute.ts [--mode=nodes]
// ============================================================

if (import.meta.main) {
  const mode = Deno.args.includes("--mode=nodes") ? "nodes" : "emulator";
  if (mode === "nodes") {
    try { await Deno.stat("./infra/l1-utxos.ready"); }
    catch { console.error("Infrastructure not ready — l1-utxos.ready not found. Is docker compose up?"); Deno.exit(1); }
  }
  console.log(`Running dispute.ts in ${mode} mode...`);

  if (mode === "emulator") {
    await main();
  } else {
    // ── Setup environment connecting to real Hydra heads ────
    const env = await setupHydraNodesEnvironment();

    // ── Wrap first (prerequisite for dispute) ───────────────
    const { wrappedValidator, wrappedAddress, wrappedDatum, wrappedDatumB } =
      await performWrapTransactions(
        env.lucid1A,
        env.lucid2B,
        env.privateKey1,
        env.privateKey2,
        env.emulatorA,
        env.emulatorB,
      );

    // ── Build address → name lookup ─────────────────────────
    const handlerA = (env.emulatorA as HydraNodeProvider).getHandler();
    const handlerB = (env.emulatorB as HydraNodeProvider).getHandler();

    const addrNames: Record<string, string> = {
      [env.address1]: "alice",
      [env.address2]: "ida",
      [env.address3]: "bob",
      [wrappedAddress]: "validator",
    };
    const label = (addr: string) =>
      addrNames[addr] ?? addr.slice(0, 30) + "…";
    const logUtxo = (u: {
      txHash: string;
      outputIndex: number;
      assets: Assets;
      address: string;
    }) =>
      console.log(
        `  ${u.txHash}#${u.outputIndex}: ${u.assets.lovelace} lovelace  [${label(u.address)}]`,
      );

    // ── Snapshots BEFORE dispute ────────────────────────────
    console.log("\n--- Head A snapshot BEFORE dispute ---");
    const snapA0 = await handlerA.getSnapshot();
    for (const u of snapA0) logUtxo(u);
    if (snapA0.length === 0) console.log("  (empty)");

    console.log("\n--- Head B snapshot BEFORE dispute ---");
    const snapB0 = await handlerB.getSnapshot();
    for (const u of snapB0) logUtxo(u);
    if (snapB0.length === 0) console.log("  (empty)");
    console.log("");

    // ── Perform dispute ─────────────────────────────────────
    await performDisputeTransactions(
      env,
      wrappedValidator,
      wrappedAddress,
      wrappedDatum,
      wrappedDatumB!,
    );

    console.log("Dispute transactions completed successfully!");

    // ── Check final balances ────────────────────────────────
    const finalAliceUtxos = await env.lucid1A.wallet.getUtxos();
    const finalAliceBalance = finalAliceUtxos.reduce(
      (acc, utxo) => acc + utxo.assets.lovelace,
      0n,
    );
    const finalIdaUtxos = await env.lucid2B.wallet.getUtxos();
    const finalIdaBalance = finalIdaUtxos.reduce(
      (acc, utxo) => acc + utxo.assets.lovelace,
      0n,
    );

    console.log(
      `Alice's final balance in head A: ${finalAliceBalance.toString()}`,
    );
    console.log(
      `Ida's final balance in head B: ${finalIdaBalance.toString()}`,
    );

    // ── Snapshots AFTER dispute ─────────────────────────────
    console.log("\n--- Head A snapshot AFTER dispute ---");
    const snapA1 = await handlerA.getSnapshot();
    for (const u of snapA1) logUtxo(u);
    if (snapA1.length === 0) console.log("  (empty)");

    console.log("\n--- Head B snapshot AFTER dispute ---");
    const snapB1 = await handlerB.getSnapshot();
    for (const u of snapB1) logUtxo(u);
    if (snapB1.length === 0) console.log("  (empty)");

    handlerA.stop();
    handlerB.stop();
  }
} else {
  console.log("dispute.ts imported as module");
}
