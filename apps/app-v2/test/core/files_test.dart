import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/core/files.dart';

void main() {
  test('the file name comes from the server, encoded or plain', () {
    expect(fileNameFrom("attachment; filename*=UTF-8''Sales%20contract%20SC-1.pdf"), 'Sales contract SC-1.pdf');
    expect(fileNameFrom('attachment; filename="bl.pdf"'), 'bl.pdf');
    expect(fileNameFrom(null), isNull);
  });

  test('each kind of file gets the right viewer', () {
    expect(kindOf('application/pdf', 'a.pdf'), FileKind.pdf);
    expect(kindOf('image/jpeg', 'a.jpg'), FileKind.image);
    expect(kindOf('image/heic', 'a.heic'), FileKind.other, reason: 'HEIC opens in another app');
    expect(kindOf('video/mp4', 'a.mp4'), FileKind.video);
    expect(kindOf('text/csv', 'a.csv'), FileKind.text);
    expect(kindOf(mimeFor('report.xlsx'), 'report.xlsx'), FileKind.other);
    expect(const RemoteFile(path: '/x', name: 'Scan.PDF').kind, FileKind.pdf);
  });

  test('sizes read like people say them', () {
    expect(fileSize(12), '12 B');
    expect(fileSize(2048), '2 KB');
    expect(fileSize(3 * 1024 * 1024 + 200000), '3.2 MB');
  });
}
