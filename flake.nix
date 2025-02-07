{
  description = "EUTxO L2 Interoperability";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = inputs@{ self, flake-utils, nixpkgs, ... }:
    flake-utils.lib.eachSystem flake-utils.lib.defaultSystems (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      rec {
        inherit inputs;
        legacyPackages = pkgs;
        packages.mdbook =
          (
            pkgs.stdenv.mkDerivation {
              name = "eutxo-l2-interop-book";
              src = ./.;
              buildInputs = with pkgs; [
                mdbook
                mdbook-mermaid
                mdbook-katex
                mdbook-alerts
              ];
              phases = [ "unpackPhase" "buildPhase" ];
              buildPhase = ''
                mdbook build -d $out
              '';
            }
          );
        defaultPackage = packages.mdbook;
      }
    );
}
