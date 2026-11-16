import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/picker.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';

/// One optional proof (a slip, a receipt): photo first, or a file. Refuses files over the
/// limit with the size and the limit. The form reads [file] when it saves.
class ProofField extends ConsumerStatefulWidget {
  const ProofField({super.key, required this.label, required this.help, required this.onChanged});
  final String label, help;
  final ValueChanged<PickedFile?> onChanged;

  @override
  ConsumerState<ProofField> createState() => _ProofFieldState();
}

class _ProofFieldState extends ConsumerState<ProofField> {
  PickedFile? _file;
  String? _error;

  Future<void> _pick(Future<PickedFile?> Function() how) async {
    final f = await how();
    if (f == null || !mounted) return;
    final no = refuse(f);
    setState(() {
      _error = no;
      _file = no == null ? f : _file;
    });
    widget.onChanged(_file);
  }

  @override
  Widget build(BuildContext context) {
    final p = ref.read(pickerProvider);
    return KFileField(
      label: widget.label,
      help: widget.help,
      error: _error,
      files: [if (_file != null) KFileItem(name: _file!.name, bytes: _file!.size)],
      onTakePhoto: () => _pick(p.photo),
      onChooseFile: () => _pick(p.file),
      onRemove: (_) {
        setState(() => _file = null);
        widget.onChanged(null);
      },
    );
  }
}
