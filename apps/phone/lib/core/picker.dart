import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

/// A file picked on the phone, not sent yet.
class PickedFile {
  const PickedFile(this.bytes, this.name);
  final Uint8List bytes;
  final String name;
  int get size => bytes.length;
  bool get isVideo => RegExp(r'\.(mp4|mov|m4v|3gp)$', caseSensitive: false).hasMatch(name);
}

/// The system's limits: 25 MB a file, videos 100 MB.
const maxFileBytes = 25 * 1024 * 1024;
const maxVideoBytes = 100 * 1024 * 1024;

/// Why [f] can't be sent, or null when it can.
String? refuse(PickedFile f) {
  final limit = f.isVideo ? maxVideoBytes : maxFileBytes;
  if (f.size <= limit) return null;
  String mb(int b) => '${(b / 1024 / 1024).toStringAsFixed(1)} MB';
  return '${f.name} is ${mb(f.size)}; the limit is ${mb(limit)}.';
}

/// How the phone picks files. Replaced in tests.
abstract class Picker {
  Future<PickedFile?> photo();
  Future<PickedFile?> file();
}

class PhonePicker implements Picker {
  const PhonePicker();

  @override
  Future<PickedFile?> photo() async {
    final x = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 85, maxWidth: 2600);
    return x == null ? null : PickedFile(await x.readAsBytes(), x.name);
  }

  @override
  Future<PickedFile?> file() async {
    final r = await FilePicker.pickFiles();
    if (r.isEmpty) return null;
    return PickedFile(await r.first.readAsBytes(), r.first.name);
  }
}
