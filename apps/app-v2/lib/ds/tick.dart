import 'fields.dart';

/// A checklist item's pages or photo: uploaded to the order first, then sent as [asField]
/// (e.g. attachmentId) or only filed on [step].
class TickFile {
  const TickFile({required this.step, this.kind = 'other', this.asField});
  final String step, kind;
  final String? asField;
}

/// What one checklist item asks to be ticked and where the answer goes (spec/ticks.yaml).
class TickForm {
  const TickForm({
    required this.method,
    required this.path,
    required this.fields,
    this.send = const {},
    this.prefill = const {},
    this.hint,
    this.file,
  });

  final String method, path;
  final List<FieldDef> fields;

  /// Fixed values sent with the answers ({ status: booked }).
  final Map<String, Object?> send;

  /// Where each answer starts from: the first of these that has a value.
  final Map<String, List<String>> prefill;
  final String? hint;
  final TickFile? file;
}
