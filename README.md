# EUTxO-L2 interoperability

> Connect Hydra and other L2s

👉 <a href="https://cardano-scaling.github.io/eutxo-l2-interop"><big>Technical Report</big></a> 👈

## Building

The report for this project can be viewed [directly in Github](./book/README.md) or built into [the HTML site](https://cardano-scaling.github.io/eutxo-l2-interop) using [mdbook][mdbook].

### With cargo

You can install [mdbook][mdbook] and the plugins we use with `cargo`:

```shell
cargo install mdbook mdbook-katex mdbook-mermaid mdbook-alerts
```

Then, build with:

```shell
mdbook build
```

<details>
<summary>Binary install</summary>

There's also an option to install directly from binaries with `cargo binstall`:

```shell
cargo install cargo-binstall # If you don't already have it
cargo binstall mdbook mdbook-katex mdbook-mermaid mdbook-alerts
```

</details>

### With nix

You can also use [nix][nix]:

```shell
nix build -o out
```

## Editing

With [mdbook][mdbook] installed or inside a `nix develop` shell, you
can live preview the result with:

```shell
mdbook serve --open
```

See the [mdbook manual][mdbook] or [github flavored markdown][gfm] for
more information on what is available for editing.

[mdbook]: https://rust-lang.github.io/mdBook/index.html
[gfm]: https://github.github.com/gfm/
[nix]: https://nixos.org/download.html
