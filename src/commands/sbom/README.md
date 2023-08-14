

https://github.com/stephenh/ts-proto

```bash
protoc --proto_path=./src/commands/sbom/protobuf/  --plugin=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=src/commands/sbom/protobuf/ ./src/commands/sbom/protobuf/bom-1.4.proto
```


```bash
protoc --proto_path=./src/commands/sbom/protobuf/  --plugin=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=src/commands/sbom/protobuf/ ./src/commands/sbom/protobuf/sbom_intake.proto
```
