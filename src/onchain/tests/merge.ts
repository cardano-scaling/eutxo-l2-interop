import {
  type Assets,
  Crypto,
  Data,
  Lucid,
  type Provider,
  type Script,
} from "https://deno.land/x/lucid@0.20.14/mod.ts";
import {
  AdhocLedgerV4WrappedDatum,
  AdhocLedgerV4WrappedSpend,
} from "./plutus.ts";
import { HydraEmulator } from "./hydra_emulator.ts";

// Import reusable functions
import {
  setupWrapEnvironment,
  setupHydraNodesEnvironment,
  performWrapTransactions,
} from "./wrap.ts";
import { performDisputeTransactions } from "./dispute.ts";
import { HydraNodeProvider } from "./hydra_node_provider.ts";
import { CardanoCliProvider } from "./cardano_provider.ts";

// Main emulator test (original logic)
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

  //
  // CREATE COMBINED EMULATOR FROM BOTH HEADS
  //
  const utxosA = env.emulatorA.getState().getLedger();
  const utxosB = env.emulatorB.getState().getLedger();
  const combinedUtxos = [...utxosA, ...utxosB];
  
  const emulatorMain = HydraEmulator.withUtxos(combinedUtxos);
   
  console.log("Combined emulator created with", combinedUtxos.length, "total UTXOs");
  console.log("UTXOs from head A:", utxosA.length, "from head B:", utxosB.length);
   
  // Verify the combined emulator has all UTXOs (duplicates automatically handled by EmulatorState)
  const combinedLedger = emulatorMain.getState().getLedger();
  console.log("Combined emulator ledger contains", combinedLedger.length, "UTXOs (duplicates removed)");

  //
  // CREATE LUCID INSTANCE FOR COMBINED EMULATOR WITH ALICE KEYS
  //
  const lucidMain = new Lucid({
    provider: emulatorMain,
    wallet: { PrivateKey: env.privateKey1 },
  });
   
  console.log("Created Lucid instance for combined emulator with Alice's keys");
   
  // Test the combined Lucid instance by checking Alice's UTXOs
  const aliceCombinedUtxos = await lucidMain.utxosAt(env.address1);
  console.log("Alice's UTXOs in combined emulator:", aliceCombinedUtxos.length);
  
  const aliceCombinedBalance = aliceCombinedUtxos.reduce((acc, utxo) =>
    acc + utxo.assets.lovelace, 0n);
  console.log("Alice's total balance in combined emulator:", aliceCombinedBalance.toString());

  const idaCombinedUtxos = await lucidMain.utxosAt(env.address2);
  const idaCombinedBalance = idaCombinedUtxos.reduce((acc, utxo) =>
    acc + utxo.assets.lovelace, 0n);
  console.log("Ida's total balance in combined emulator:", idaCombinedBalance.toString());

  //
  // SPEND BOTH DISPUTED UTXOS USING COMBINED LUCID INSTANCE
  //
  
  // Get the disputed UTXOs from the wrapped address
  const disputedUtxos = await lucidMain.utxosAt(wrappedAddress);
  console.log("Found", disputedUtxos.length, "UTXOs at wrapped address");

  // Find the specific disputed UTXOs we want to spend
  const disputeUtxoA = disputedUtxos.find(utxo => 
    utxo.txHash === disputeTxAHash && utxo.outputIndex === 0
  );
  const disputeUtxoB = disputedUtxos.find(utxo => 
    utxo.txHash === disputeTxBHash && utxo.outputIndex === 0
  );

  if (!disputeUtxoA) {
    console.log("Dispute UTXO A not found:", disputeTxAHash, "#0");
  }
  if (!disputeUtxoB) {
    console.log("Dispute UTXO B not found:", disputeTxBHash, "#0");
  }

  if (disputeUtxoA && disputeUtxoB) {
    console.log("Found both disputed UTXOs, creating spend transaction...");
    
    const spendTxs = await lucidMain.newTx()
      .collectFrom([disputeUtxoA, disputeUtxoB], Data.to("Merge", AdhocLedgerV4WrappedSpend.redeemer))
      .payTo(env.address1, { lovelace: 5000000n }) // Send 5 ADA back to Alice
      .payTo(env.address2, { lovelace: 5000000n }) // Send 5 ADA back to Ida
      .attachScript(wrappedValidator)
      .commit();

    const signedSpendTxs = await spendTxs.sign().commit();
    const spendTxsHash = await signedSpendTxs.submit();
    emulatorMain.awaitTx(spendTxsHash);
    
    console.log("SPEND BOTH DISPUTED UTXOS TX:", spendTxsHash);
    
    // Check final balances after spending
    const finalAliceUtxos = await lucidMain.utxosAt(env.address1);
    const finalAliceBalance = finalAliceUtxos.reduce((acc, utxo) =>
      acc + utxo.assets.lovelace, 0n);
    console.log("Alice's final balance after spending disputed UTXOs:", finalAliceBalance.toString());

    // ── Emulator-only assertions ──────────────────────────────
    await assertMergeResults(lucidMain, wrappedAddress, env.address1, env.address2, aliceCombinedBalance, idaCombinedBalance);
  }
}

// ============================================================
// Assertions (emulator-only) — verify merge consumed disputed UTXOs
// ============================================================

async function assertMergeResults(
  lucid: Lucid,
  wrappedAddress: string,
  aliceAddress: string,
  idaAddress: string,
  aliceBalanceBefore: bigint,
  idaBalanceBefore: bigint,
) {
  // Script address must be empty after merge
  const scriptUtxos = await lucid.utxosAt(wrappedAddress);
  if (scriptUtxos.length !== 0) {
    throw new Error(`Expected 0 UTXOs at script address after merge, found ${scriptUtxos.length}`);
  }

  // Alice must have received her 5 ADA back (minus merge tx fee, < 0.5 ADA)
  const aliceUtxos = await lucid.utxosAt(aliceAddress);
  const aliceBalanceAfter = aliceUtxos.reduce((acc, u) => acc + u.assets.lovelace, 0n);
  const aliceGain = aliceBalanceAfter - aliceBalanceBefore;
  if (aliceGain < 4_500_000n || aliceGain > 5_000_000n) {
    throw new Error(`Alice should have gained ~5 ADA (minus fee), actual gain: ${aliceGain} lovelace`);
  }

  // Ida must have gained exactly 5 ADA (she doesn't pay the fee)
  const idaUtxos = await lucid.utxosAt(idaAddress);
  const idaBalanceAfter = idaUtxos.reduce((acc, u) => acc + u.assets.lovelace, 0n);
  const idaGain = idaBalanceAfter - idaBalanceBefore;
  if (idaGain !== 5_000_000n) {
    throw new Error(`Ida should have gained exactly 5 ADA, actual gain: ${idaGain} lovelace (before=${idaBalanceBefore}, after=${idaBalanceAfter})`);
  }

  console.log(`✅ Assertions passed: script address empty, Alice +${aliceGain} lovelace (5 ADA minus merge tx fee), Ida +${idaGain} lovelace (5 ADA)`);
}

// ============================================================
// Merge disputed UTXOs on L1 (used after close+fanout in nodes mode)
//
// Uses the Merge redeemer from adhoc_ledger_v4. The validator requires:
//   - Both disputed UTXOs as inputs (own + replica matched by same nonce)
//   - outputs[0] goes to datum.owner with the input value
//   - outputs[1..] go to intermediaries with their specified amounts
// ============================================================

export async function mergeOnL1(
  l1Provider: Provider,
  wrappedValidator: Script,
  wrappedAddress: string,
  signerPrivateKey: string,
  aliceAddress: string,
  idaAddress: string,
): Promise<string> {
  const lucid = new Lucid({
    provider: l1Provider,
    wallet: { PrivateKey: signerPrivateKey },
  });

  const signerHash = Crypto.privateKeyToDetails(signerPrivateKey).credential.hash;

  // Find both disputed UTXOs at the script address
  const scriptUtxos = await lucid.utxosAt(wrappedAddress);
  const disputedUtxos = scriptUtxos.filter(u => {
    if (!u.datum) return false;
    try {
      const d = Data.from(u.datum, AdhocLedgerV4WrappedSpend.datumOpt);
      return d.disputed === true;
    } catch { return false; }
  });

  if (disputedUtxos.length < 2) {
    throw new Error(`Expected 2 disputed UTXOs on L1, found ${disputedUtxos.length}`);
  }

  // Decode datums to identify owners
  const withDatums = disputedUtxos.map(u => ({
    utxo: u,
    datum: Data.from(u.datum!, AdhocLedgerV4WrappedSpend.datumOpt),
  }));

  for (const { utxo, datum } of withDatums) {
    console.log(`  ${utxo.txHash.slice(0, 16)}…#${utxo.outputIndex}: ${utxo.assets.lovelace} lovelace, owner=${datum.owner.slice(0, 16)}…`);
  }

  // Build the Merge transaction:
  //   - Spend both disputed UTXOs with Merge redeemer
  //   - For each input, output[0] must go to its owner with input value,
  //     followed by intermediary outputs
  const utxoA = withDatums[0];
  const utxoB = withDatums[1];

  const ownerAddrA = utxoA.datum.owner === Crypto.privateKeyToDetails(signerPrivateKey).credential.hash
    ? aliceAddress : idaAddress;
  const ownerAddrB = utxoB.datum.owner === Crypto.privateKeyToDetails(signerPrivateKey).credential.hash
    ? aliceAddress : idaAddress;

  let txBuilder = lucid.newTx()
    .addSigner(signerHash)
    .collectFrom([utxoA.utxo, utxoB.utxo], Data.to("Merge", AdhocLedgerV4WrappedSpend.redeemer))
    .attachScript(wrappedValidator);

  // Output for first UTXO's owner
  txBuilder = txBuilder.payTo(ownerAddrA, utxoA.utxo.assets);

  // Intermediary outputs for first UTXO
  for (const [vkh, lovelace] of utxoA.datum.intermediaries) {
    const intermediaryAddr = vkh === utxoA.datum.owner ? ownerAddrA
      : vkh === utxoB.datum.owner ? ownerAddrB
      : aliceAddress; // fallback
    txBuilder = txBuilder.payTo(intermediaryAddr, { lovelace });
  }

  const tx = await txBuilder.commit();
  const signed = await tx.sign().commit();
  const txHash = await signed.submit();
  await l1Provider.awaitTx(txHash);

  console.log(`  MERGE TX: ${txHash}`);
  return txHash;
}

// ============================================================
// Main — run with: deno run --allow-net --allow-read --allow-run merge.ts [--mode=nodes]
// ============================================================

if (import.meta.main) {
  const mode = Deno.args.includes("--mode=nodes") ? "nodes" : "emulator";
  if (mode === "nodes") {
    try { await Deno.stat("./infra/l1-utxos.ready"); }
    catch { console.error("Infrastructure not ready — l1-utxos.ready not found. Is docker compose up?"); Deno.exit(1); }
  }
  console.log(`Running merge.ts in ${mode} mode...`);

  if (mode === "emulator") {
    await main();
  } else {
    // ── Setup environment connecting to real Hydra heads ────
    const env = await setupHydraNodesEnvironment();
    const handlerA = (env.emulatorA as HydraNodeProvider).getHandler();
    const handlerB = (env.emulatorB as HydraNodeProvider).getHandler();

    // ── Build address → name lookup ──────────────────────────
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

    // ── Step 1: Wrap ─────────────────────────────────────────
    console.log("\n=== STEP 1: WRAP ===");
    const { wrappedValidator, wrappedAddress, wrappedDatum, wrappedDatumB } =
      await performWrapTransactions(
        env.lucid1A,
        env.lucid2B,
        env.privateKey1,
        env.privateKey2,
        env.emulatorA,
        env.emulatorB,
      );

    // ── Step 2: Dispute ──────────────────────────────────────
    console.log("\n=== STEP 2: DISPUTE ===");
    await performDisputeTransactions(
      env,
      wrappedValidator,
      wrappedAddress,
      wrappedDatum,
      wrappedDatumB!,
    );

    // ── Snapshots after dispute (before closing) ─────────────
    console.log("\n--- Head A snapshot AFTER dispute (before close) ---");
    const snapA = await handlerA.getSnapshot();
    for (const u of snapA) logUtxo(u);
    if (snapA.length === 0) console.log("  (empty)");

    console.log("\n--- Head B snapshot AFTER dispute (before close) ---");
    const snapB = await handlerB.getSnapshot();
    for (const u of snapB) logUtxo(u);
    if (snapB.length === 0) console.log("  (empty)");

    // ── Step 3: Close & Fanout both heads ────────────────────
    console.log("\n=== STEP 3: CLOSE & FANOUT ===");
    console.log("\n--- Closing Head A ---");
    await handlerA.closeAndFanout();

    console.log("\n--- Closing Head B ---");
    await handlerB.closeAndFanout();

    // Stop Hydra WebSocket handlers — we're done with the heads
    handlerA.stop();
    handlerB.stop();

    // ── Step 4: Wait for fanout UTXOs to settle on L1 ────────
    console.log("\n=== STEP 4: WAIT FOR L1 SETTLEMENT ===");
    const l1Provider = new CardanoCliProvider();

    // Wait for disputed UTXOs (with disputed=true datum) to appear at the script address on L1.
    // After fanout, UTXOs get new L1 tx hashes, so we match by datum content, not tx hash.
    const aliceOwnerHash = Crypto.privateKeyToDetails(env.privateKey1).credential.hash;
    const idaOwnerHash = Crypto.privateKeyToDetails(env.privateKey2).credential.hash;

    console.log(`Waiting for disputed UTXOs to appear on L1 at ${wrappedAddr.slice(0, 40)}…`);
    let retries = 0;
    while (retries < 30) {
      try {
        const utxos = await l1Provider.getUtxos(wrappedAddr);
        // Filter to only UTXOs with an inline datum containing disputed=true
        const disputed = utxos.filter(u => {
          if (!u.datum) return false;
          try {
            const d = Data.from(u.datum, AdhocLedgerV4WrappedSpend.datumOpt);
            return d.disputed === true;
          } catch { return false; }
        });
        const foundAlice = disputed.some(u => {
          const d = Data.from(u.datum!, AdhocLedgerV4WrappedSpend.datumOpt);
          return d.owner === aliceOwnerHash;
        });
        const foundIda = disputed.some(u => {
          const d = Data.from(u.datum!, AdhocLedgerV4WrappedSpend.datumOpt);
          return d.owner === idaOwnerHash;
        });
        if (foundAlice && foundIda) {
          console.log(`Found both disputed UTXOs on L1 after ${retries + 1} polls`);
          break;
        }
        console.log(`  Poll ${retries + 1}: found ${utxos.length} UTXOs (disputed: ${disputed.length}, Alice=${foundAlice}, Ida=${foundIda})`);
      } catch (e) {
        console.log(`  Poll ${retries + 1}: query failed (${e}), retrying...`);
      }
      await new Promise(r => setTimeout(r, 3000));
      retries++;
    }
    if (retries >= 30) {
      throw new Error("Timed out waiting for disputed UTXOs on L1");
    }

    // ── L1 UTXOs BEFORE merge ──────────────────────────────────
    console.log("\n--- L1 UTXOs BEFORE merge ---");
    console.log("  Script address:");
    const l1ScriptBefore = await l1Provider.getUtxos(wrappedAddr);
    for (const u of l1ScriptBefore) logUtxo(u);
    console.log("  Alice:");
    for (const u of await l1Provider.getUtxos(env.address1)) logUtxo(u);
    console.log("  Ida:");
    for (const u of await l1Provider.getUtxos(env.address2)) logUtxo(u);
    console.log("  Bob:");
    for (const u of await l1Provider.getUtxos(env.address3)) logUtxo(u);

    // ── Step 5: Merge on L1 ──────────────────────────────────
    // Spend both disputed UTXOs in a single tx using the Merge redeemer.
    console.log("\n=== STEP 5: MERGE ON L1 ===");

    await mergeOnL1(
      l1Provider,
      wrappedValidator,
      wrappedAddr,
      env.privateKey1,
      env.address1,
      env.address2,
    );

    // ── L1 UTXOs AFTER merge ─────────────────────────────────
    console.log("\n--- L1 UTXOs AFTER merge ---");
    console.log("  Script address:");
    const l1ScriptAfter = await l1Provider.getUtxos(wrappedAddr);
    for (const u of l1ScriptAfter) logUtxo(u);
    if (l1ScriptAfter.length === 0) console.log("    (empty)");
    console.log("  Alice:");
    const aliceL1 = await l1Provider.getUtxos(env.address1);
    for (const u of aliceL1) logUtxo(u);
    const aliceTotal = aliceL1.reduce((acc, u) => acc + u.assets.lovelace, 0n);
    console.log(`    total: ${aliceTotal} lovelace (${aliceL1.length} UTXOs)`);
    console.log("  Ida:");
    const idaL1 = await l1Provider.getUtxos(env.address2);
    for (const u of idaL1) logUtxo(u);
    const idaTotal = idaL1.reduce((acc, u) => acc + u.assets.lovelace, 0n);
    console.log(`    total: ${idaTotal} lovelace (${idaL1.length} UTXOs)`);
    console.log("  Bob:");
    const bobL1 = await l1Provider.getUtxos(env.address3);
    for (const u of bobL1) logUtxo(u);
    const bobTotal = bobL1.reduce((acc, u) => acc + u.assets.lovelace, 0n);
    console.log(`    total: ${bobTotal} lovelace (${bobL1.length} UTXOs)`);
  }
} else {
  console.log("merge.ts imported as module");
}
