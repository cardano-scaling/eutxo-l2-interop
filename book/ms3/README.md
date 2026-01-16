# Milestone 3

Consists of three parts

1. Multi-L2 topologies
2. Model efficiency comparisson
3. Performance metrics

In this third milestone we are looking at how we can extend the system we've built to more than 2 L2 ledgers. We look into multiple possible topologies and compare how different configurations of topologies and models perform.

## Topologies Explanation

### Two-heads topology

![Two Heads topology](two-heads.svg)

The two-heads topology is the simplest topology, it consists of two heads, each with two participants.

The use case for this topology is HTLC-based payments between two parties from different heads, with some party acting as intermediary (present in both heads) i.e. single hop payment.

### Single-path topology

The single-path topology is the natural expansion of the two-heads topology, for each new participant a new head is added with a new intermediary that "joins"[^1] the previous end head as well. In this manner, each user can interact directly with at most two other users. Each "middle" head now has three participants, one user and two intermediaries while both ends of the chain have only two participants. Using this topology payments might require up to N-1 hops for N heads, with the benefit of splitting the liquidity requirements between multiple intermediaries.

The single path topology for three and four heads would look like this:

![Single Path three heads](single-path.svg)

![Single Path four heads](single-path-4-heads.svg)

And it's easy to see that it can be expanded indefinitely.

[^1]: As we are talking about static topologies, participants don't join already running networks. Rather they join during a "planning" phase where heads and intermediaries are being designed.

### Hub-and-spoke topology

The hub-and-spoke topology is a topology where one intermediary acts as hub for all heads. For each new participant a new head is added with the intermediary in it. Each head has only two participants. This topology allows all payments to be achieved with only a single hop, but carries a high liquidity requirement for the intermediary.

Hub and spoke with three or X heads, here we represent Ida outside the heads to show that all payments flow trough them in a single hop

![Hub and Spoke three heads](hub-and-spoke.svg)

![Hub and Spoke X heads](hub-and-spoke-x-heads.svg)

## Model efficiency

We will compare the theoretical efficiency of the adhoc-ledger design vs point-to-point transactions and the implemented HTLC system across multiple dimesions such as:

* Transaction cost/count
* Liquidity constraints
* Infrastructure cost

### Transaction cost

Transaction cost is hard to pinpoint due to the configurable nature of L2s. In hydra for example, each head can set their own parameters and it is often the case where transaction fees are waived completely. Nonetheless we can compare the transaction count of different scenarios to get an idea of which is more efficient.

Using HTLCs, for each hop we have a total of four transactions, two create and two claim. Create transactions don't run any plutus script while claim transactions have some basic validations. We can then express the cost for $n$ hops as follows:

$$
2 * (n + 1) * c + (n + 1) * p
$$

where $c$ is the base cost of a transaction and $p$ is the added cost of running the HTLC script.

It's clear that a multi-hop setup would require more fees than the single hop hub-and-spoke topology.

Adhoc

$$
2 * m * c * p
$$

TODO:
* constant cost for a fixed number of heads $m$
* For transactions with multiple recipients, adhoc takes the lead vs making multiple htlc payments

### Liquidity contraints

For a desired capacity of $t$ lovelaces, you need $m * t$ liquidity.

TODO:
* Single path spreads requirements evenly between m-1 intermediaries
* Hub and spoke puts alls preasure into hub intermediary
* Adhoc leaves room for intermediaries to provide different amount of liquidity.

### Infrastructure cost

TODO:
* Is this relevant? Number of nodes needed vary per topology more than per system

## Recomendations

For a big scale deployment we think it's best, as it's usually the case in life, a balanced approach that would consist of multiple hub-and-spoke clusters, with the hubs themselves creating a single path network. This topology would minimize hops needed between close participants while aliviating liquidity pressure from intermediaries, allowing them to add more spokes as more liquidity is aquired.
