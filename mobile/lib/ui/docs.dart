import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:open_filex/open_filex.dart';
import 'package:share_plus/share_plus.dart';

import '../core/session.dart';
import 'kit.dart';

/// Downloads a PDF (the same file the web's "Download PDF" gives) and opens or shares it.
Future<void> openPdf(BuildContext context, WidgetRef ref, {required String path, required String fileName, bool share = false}) async {
  final api = ref.read(apiProvider);
  toast(context, 'Preparing $fileName…');
  try {
    final local = await api.download(path, fileName.endsWith('.pdf') ? fileName : '$fileName.pdf');
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    if (share) {
      await SharePlus.instance.share(ShareParams(files: [XFile(local, mimeType: 'application/pdf')], subject: fileName));
    } else {
      final result = await OpenFilex.open(local, type: 'application/pdf');
      if (result.type != ResultType.done && context.mounted) {
        await SharePlus.instance.share(ShareParams(files: [XFile(local, mimeType: 'application/pdf')], subject: fileName));
      }
    }
  } catch (e) {
    if (context.mounted) toast(context, e.toString(), error: true);
  }
}

/// Download any attachment and open it with the phone's viewer.
Future<void> openFile(BuildContext context, WidgetRef ref, {required String id, required String fileName}) async {
  final api = ref.read(apiProvider);
  toast(context, 'Downloading $fileName…');
  try {
    final local = await api.download('/api/attachments/$id', fileName);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    final result = await OpenFilex.open(local);
    if (result.type != ResultType.done && context.mounted) {
      await SharePlus.instance.share(ShareParams(files: [XFile(local)], subject: fileName));
    }
  } catch (e) {
    if (context.mounted) toast(context, e.toString(), error: true);
  }
}

/// "PDF" button: tap opens, menu offers share.
class PdfButton extends ConsumerWidget {
  const PdfButton({super.key, required this.path, required this.fileName});
  final String path;
  final String fileName;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PopupMenuButton<String>(
      tooltip: 'PDF',
      icon: const Icon(Icons.picture_as_pdf_outlined),
      onSelected: (v) => openPdf(context, ref, path: path, fileName: fileName, share: v == 'share'),
      itemBuilder: (_) => const [
        PopupMenuItem(value: 'open', child: ListTile(leading: Icon(Icons.open_in_new_rounded), title: Text('Open PDF'), dense: true)),
        PopupMenuItem(value: 'share', child: ListTile(leading: Icon(Icons.ios_share_rounded), title: Text('Share PDF'), dense: true)),
      ],
    );
  }
}
