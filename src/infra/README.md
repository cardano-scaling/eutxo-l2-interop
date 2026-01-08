# Infrastructure

This directory contains the infrastructure for the EUTxO L2 Interoperability project.

## Usage

To start the infrastructure with the simplest topology: only two heads, run:

```bash
docker compose -f docker-compose.two-heads.yaml up
```

![Two-heads topology](./two_heads.png)

To start the infrastructure with the single-path topology: 4 heads in a chain, run:

```bash
docker compose -f docker-compose.single-path.yaml up
```

![Single-path topology](./single_path.png)

To start the infrastructure with the hub-and-spoke topology: 4 heads, with the hub (head D) conneted to the other three spokes, run:

```bash
docker compose -f docker-compose.hub-and-spoke.yaml up
```

![Hub-and-spoke topology](./hub_and_spoke.png)

## Topologies Explanation

### Two-heads topology

The two-heads topology is the simplest topology, it consists of two heads, each with two participants.

The use case for this topology is HTLC-based payments between two parties from different heads, with some party acting as intermediary (present in both heads) i.e. single hop payment.

### Single-path topology

The single-path topology is a topology where four heads are connected in a chain, two participants each.

The use case for this topology is HTLC-based payments between two parties from different heads, by potentially needing multiple hops.

### Hub-and-spoke topology

The hub-and-spoke topology is a topology where the heads are connected in a hub and spoke pattern, with the hub (head D) conneted to the other three spokes (heads A, B and C).

The use case for this topology is HTLC-based payments between two parties from different heads using two hops, with the hub (head D) acting as intermediary (whose participants are present in all heads).
