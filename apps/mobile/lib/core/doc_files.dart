import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Where documents handed to other apps are written: a folder of our own in the
/// app's temporary space, emptied when the person signs out (prices and bank
/// details should not stay on a phone someone else may use next).
Future<Directory> documentsTempDir() async {
  final dir = Directory('${(await getTemporaryDirectory()).path}/kebo-docs');
  if (!await dir.exists()) await dir.create(recursive: true);
  return dir;
}

Future<void> clearDocumentFiles() async {
  if (kIsWeb) return;
  try {
    final dir = Directory('${(await getTemporaryDirectory()).path}/kebo-docs');
    if (await dir.exists()) await dir.delete(recursive: true);
  } catch (_) {}
}
