import 'dart:typed_data';

/// A file read from the server, with the name and type it came with.
class Downloaded {
  const Downloaded(this.bytes, {this.fileName, this.type});
  final Uint8List bytes;
  final String? fileName, type;
}

/// "attachment; filename*=UTF-8''Sales%20contract.pdf" → "Sales contract.pdf".
String? fileNameFrom(String? disposition) {
  if (disposition == null) return null;
  final star = RegExp(r"filename\*=UTF-8''([^;]+)", caseSensitive: false).firstMatch(disposition);
  if (star != null) return Uri.decodeComponent(star.group(1)!.trim());
  final plain = RegExp(r'filename="?([^";]+)"?', caseSensitive: false).firstMatch(disposition);
  return plain?.group(1)?.trim();
}
