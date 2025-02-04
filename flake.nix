{
  description = "datadog-ci";
  nixConfig.bash-prompt-prefix = "\[datadog-ci\] ";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/24.05";

    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    (flake-utils.lib.eachDefaultSystem (
      system:
      let
        # setup dependencies
        pkgs = nixpkgs.legacyPackages.${system};
        node = pkgs.nodejs_20;

        datadog-ci = pkgs.buildNpmPackage rec {
          pname = "datadog-ci";
          version = "0.0.0";

          src = ./.;

          npmDepsHash = "sha256-LeQhCZfS89hMm+9KmQ5Qf2Gk/YnWM+IZGTgGPSzbAak=";
          nativeBuildInputs = [ node pkgs.yarn ];

          # The prepack script runs the build script, which we'd rather do in the build phase.
          npmPackFlags = [ "--ignore-scripts" ];
        };

        image = pkgs.dockerTools.buildImage {
          name = "ghcr.io/datadog/datadog-ci-nix";
          tag = "latest";
          copyToRoot = pkgs.buildEnv {
            name = "root";
            paths = [ datadog-ci ];
            pathsToLink = [ "/bin" ];
          };
          config = {
            entrypoint = [ "/bin/datadog-ci" ];
          };
        };
      in
      {
        packages = {
          inherit datadog-ci image;
          default = datadog-ci;
        };
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = [ node pkgs.yarn ];
        };
      }
    ));
}
