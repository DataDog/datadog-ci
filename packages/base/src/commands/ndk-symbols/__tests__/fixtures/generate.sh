#!/bin/bash
# Regenerates the native library fixtures of the ndk-symbols tests.
# Usage: NDK_BIN=<Android NDK>/toolchains/llvm/prebuilt/<host>/bin ./generate.sh
# (made with NDK r28c). Run it from this directory.
set -euo pipefail

: "${NDK_BIN:?Set NDK_BIN to the LLVM bin directory of the Android NDK}"
cd "$(dirname "$0")"

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
printf 'int datadog_fixture_add(int a, int b) { return a + b; }\n' > "$src/native.c"
printf 'int datadog_fixture_other(int a) { return a * 3; }\n' > "$src/other.c"

# Keep build paths out of the fixtures' debug info.
build() { # <clang target> <output> <source> [extra flags]
  local target=$1 output=$2 source=$3
  shift 3
  mkdir -p "$(dirname "$output")"
  "$NDK_BIN/clang" --target="$target" -shared -fPIC -O1 -ffile-prefix-map="$src"=. -fdebug-compilation-dir=. "$@" -o "$output" "$source"
}

# A library with a symbol table for each Android ABI
build aarch64-linux-android23 libs/arm64-v8a/libnative.so "$src/native.c"
build armv7a-linux-androideabi23 libs/armeabi-v7a/libnative.so "$src/native.c"
build i686-linux-android23 libs/x86/libnative.so "$src/native.c"
build x86_64-linux-android23 libs/x86_64/libnative.so "$src/native.c"

# A stripped library: no symbol table, no debug info
mkdir -p stripped/arm64-v8a
"$NDK_BIN/llvm-strip" --strip-all -o stripped/arm64-v8a/libstripped.so libs/arm64-v8a/libnative.so

# Debug info but no symbol table
build aarch64-linux-android23 "$src/libdebug.so" "$src/native.c" -g
mkdir -p debug-only/arm64-v8a
"$NDK_BIN/llvm-objcopy" --remove-section=.symtab --remove-section=.strtab "$src/libdebug.so" debug-only/arm64-v8a/libdebugonly.so

# A debug-only copy (no code), as made by `objcopy --only-keep-debug`
mkdir -p no-code/arm64-v8a
"$NDK_BIN/llvm-objcopy" --only-keep-debug "$src/libdebug.so" no-code/arm64-v8a/libnocode.so

# A library under a name Android wouldn't load (as Mono AOT writes them in obj/)
mkdir -p odd-name/arm64-v8a
cp libs/arm64-v8a/libnative.so odd-name/arm64-v8a/App1.dll.so

# A big-endian library
build aarch64_be-linux-gnu big-endian/libbigendian.so "$src/native.c" -nostdlib

# The same library at another place, and a different library with the same name
mkdir -p overlap/arm64-v8a
cp libs/arm64-v8a/libnative.so overlap/arm64-v8a/libnative.so
build aarch64-linux-android23 conflict/arm64-v8a/libnative.so "$src/other.c"

# Files that aren't native libraries
mkdir -p not-elf no-libraries
printf 'not an ELF file\n' > not-elf/libfake.so
printf 'This directory has no native library, to test the "nothing found" case.\n' > no-libraries/README.txt
