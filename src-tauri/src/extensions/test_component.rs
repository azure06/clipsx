//! Small real component for host/runtime regressions; never shipped in the app.
use wit_parser::{abi::WasmType, ManglingAndAbi, Resolve, WasmExport, WasmExportKind, WorldItem};

pub(super) fn bytes() -> Vec<u8> {
    let mut resolve = Resolve::default();
    let (package, _) = resolve
        .push_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/wit"))
        .unwrap();
    let world = resolve.select_world(&[package], Some("extension")).unwrap();
    let abi = ManglingAndAbi::Standard32;
    let memory = resolve.wasm_export_name(abi, WasmExport::Memory);
    let mut module =
        format!("(module (memory (export {memory:?}) 2) (global $heap (mut i32) (i32.const 4096))");
    for export in resolve.worlds[world].exports.values() {
        let WorldItem::Function(function) = export else {
            continue;
        };
        let signature = resolve.wasm_signature(abi.export_variant(), function);
        let name = resolve.wasm_export_name(
            abi,
            WasmExport::Func {
                interface: None,
                func: function,
                kind: WasmExportKind::Normal,
            },
        );
        module.push_str(&format!("(func (export {name:?})"));
        types(&mut module, "param", &signature.params);
        types(&mut module, "result", &signature.results);
        if function.name == "detect" {
            // All outputs use the canonical result record at address zero.
            // IDs of length 11 report unsupported; IDs of length 4 trap.
            module.push_str("(if (i32.eq (local.get 1) (i32.const 4)) (then unreachable))");
            module.push_str("(i32.store (i32.const 0) (i32.eq (local.get 1) (i32.const 11))) (i32.store (i32.const 4) (i32.const 0)) (i32.store (i32.const 8) (i32.const 0)) (i32.store (i32.const 12) (i32.const 0)) (i32.const 0)");
        } else {
            module.push_str("unreachable");
        }
        module.push(')');
        let post_return = resolve.wasm_export_name(
            abi,
            WasmExport::Func {
                interface: None,
                func: function,
                kind: WasmExportKind::PostReturn,
            },
        );
        module.push_str(&format!("(func (export {post_return:?})"));
        types(&mut module, "param", &signature.results);
        module.push(')');
    }
    let realloc = resolve.wasm_export_name(abi, WasmExport::Realloc);
    module.push_str(&format!("(func (export {realloc:?}) (param i32 i32 i32 i32) (result i32) (global.set $heap (i32.and (i32.add (global.get $heap) (i32.sub (local.get 2) (i32.const 1))) (i32.sub (i32.const 0) (local.get 2)))) (local.set 0 (global.get $heap)) (global.set $heap (i32.add (global.get $heap) (local.get 3))) (local.get 0)) )"));
    let mut module = wat::parse_str(module).unwrap();
    wit_component::embed_component_metadata(
        &mut module,
        &resolve,
        world,
        wit_component::StringEncoding::UTF8,
    )
    .unwrap();
    wit_component::ComponentEncoder::default()
        .module(&module)
        .unwrap()
        .validate(true)
        .encode()
        .unwrap()
}

fn types(module: &mut String, kind: &str, values: &[WasmType]) {
    if values.is_empty() {
        return;
    }
    module.push_str(&format!(" ({kind}"));
    for value in values {
        module.push_str(match value {
            WasmType::I32 | WasmType::Pointer | WasmType::Length => " i32",
            WasmType::I64 | WasmType::PointerOrI64 => " i64",
            WasmType::F32 => " f32",
            WasmType::F64 => " f64",
        });
    }
    module.push(')');
}

#[test]
fn export_runtime_probe_fixture() {
    if let Some(path) = std::env::var_os("CLIPSX_RUNTIME_FIXTURE_PATH") {
        std::fs::write(path, bytes()).unwrap();
    }
}
