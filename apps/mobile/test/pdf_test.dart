import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_rfq/core/api.dart';
import 'package:kebo_rfq/core/json.dart';
import 'package:kebo_rfq/core/repository.dart';
import 'package:kebo_rfq/features/orders/order_detail.dart';

/// Answers every request with [answer] and remembers what was asked.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.answer);
  final ResponseBody Function(RequestOptions o) answer;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    return answer(options);
  }

  @override
  void close({bool force = false}) {}
}

final pdfBytes = Uint8List.fromList(utf8.encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF'));

ResponseBody pdfAnswer([String? disposition]) => ResponseBody.fromBytes(pdfBytes, 200, headers: {
      'content-type': ['application/pdf'],
      'content-disposition': ?(disposition == null ? null : [disposition]),
    });

ResponseBody textAnswer(int status, String text, {String type = 'text/plain'}) => ResponseBody.fromBytes(utf8.encode(text), status, headers: {
      'content-type': [type],
    });

void main() {
  late FakeAdapter adapter;
  late KeboRepository repo;
  var signedOut = 0;
  const orderId = '196f4272-f93c-473a-a489-1d5b716b9600';

  void serve(ResponseBody Function(RequestOptions o) answer) {
    adapter = FakeAdapter(answer);
    final api = Api(baseUrl: 'https://rfq.fawadiqbal.dev/api/', dio: Dio()..httpClientAdapter = adapter, onSignedOut: () => signedOut++)..token = 'session-token-1';
    repo = KeboRepository(api);
  }

  setUp(() => signedOut = 0);

  group('PDF address and headers', () {
    test('the web app\'s /pdf/<kind>/<id> on the same server, with the session as the bearer', () async {
      serve((_) => pdfAnswer());
      await repo.pdf('proforma', orderId);
      final r = adapter.requests.single;
      expect(r.method, 'GET');
      expect(r.uri.toString(), 'https://rfq.fawadiqbal.dev/pdf/proforma/$orderId');
      expect(r.headers['Authorization'], 'Bearer session-token-1');
      expect(r.headers['Accept'], 'application/pdf');
      expect(r.responseType, ResponseType.bytes);
    });

    test('each kind: revisions by revision id, the order documents by order id', () {
      expect(KeboRepository.pdfPath('revisions', 'r1'), '/pdf/revisions/r1');
      expect(KeboRepository.pdfPath('packing-list', orderId), '/pdf/packing-list/$orderId');
      final order = <String, dynamic>{'id': orderId, 'refNo': 'SO-2026-0001'};
      Json doc(String kind, [String? rev]) => {'kind': kind, 'revisionId': ?rev};
      expect(documentPdf(order, doc('quotation', 'rev-9')), (kind: 'revisions', id: 'rev-9', fileName: 'Quotation for SO-2026-0001.pdf'));
      expect(documentPdf(order, doc('proforma')), (kind: 'proforma', id: orderId, fileName: 'Proforma invoice PI-2026-0001.pdf'));
      expect(documentPdf(order, doc('packing-list')), (kind: 'packing-list', id: orderId, fileName: 'Packing list PL-2026-0001.pdf'));
    });

    test('keeps the name the server gave the file', () async {
      serve((_) => pdfAnswer('attachment; filename="Quotation Q-2026-0001-R2.pdf"; filename*=UTF-8\'\'Quotation%20Q-2026-0001-R2.pdf'));
      final file = await repo.pdf('revisions', 'r1');
      expect(file.bytes, pdfBytes);
      expect(file.fileName, 'Quotation Q-2026-0001-R2.pdf');
      expect(Api.fileNameFrom('attachment; filename="Packing list PL-1.pdf"'), 'Packing list PL-1.pdf');
      expect(Api.fileNameFrom(null), isNull);
    });
  });

  group('is it a PDF?', () {
    test('starts with %PDF-', () {
      expect(Api.isPdf(pdfBytes), isTrue);
      expect(Api.isPdf(utf8.encode('<!DOCTYPE html><html>')), isFalse);
      expect(Api.isPdf(utf8.encode('%PDF')), isFalse);
      expect(Api.isPdf(const []), isFalse);
    });

    test('a page instead of a PDF (an older server sends its sign-in page) is refused', () async {
      serve((_) => textAnswer(200, '<!DOCTYPE html><html><body>Sign in</body></html>', type: 'text/html'));
      await expectLater(repo.pdf('proforma', orderId), throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('not with a PDF'))));
    });
  });

  group('friendly refusals', () {
    Future<ApiException> refusal(int status, String body) async {
      serve((_) => textAnswer(status, body));
      try {
        await repo.pdf('proforma', orderId);
      } on ApiException catch (e) {
        return e;
      }
      fail('expected an ApiException');
    }

    test('401: explains, and does not sign the person out of the app', () async {
      final e = await refusal(401, 'Sign in first');
      expect(e.status, 401);
      expect(e.message, contains('did not accept your sign-in'));
      expect(signedOut, 0);
    });

    test('403 and 404', () async {
      expect((await refusal(403, 'Forbidden')).message, 'You may not see this document.');
      expect((await refusal(404, 'Not found')).message, contains('not found'));
    });

    test('503: the server\'s own reason (no Chromium, busy), or a fallback', () async {
      expect((await refusal(503, 'Busy making other PDFs — please try again in a few seconds.')).message, 'Busy making other PDFs — please try again in a few seconds.');
      expect((await refusal(503, '')).message, contains('cannot make PDFs right now'));
    });

    test('other errors keep a short reason, never an HTML page', () async {
      expect((await refusal(502, 'The document could not be rendered. Please try again.')).message, 'The PDF could not be made: The document could not be rendered. Please try again.');
      expect((await refusal(500, '<html>stack trace</html>')).message, 'The PDF could not be made (500).');
    });

    test('no connection', () async {
      serve((o) => throw DioException.connectionError(requestOptions: o, reason: 'offline'));
      await expectLater(repo.pdf('proforma', orderId), throwsA(isA<ApiException>().having((e) => e.message, 'message', contains("Can't reach the server"))));
    });
  });
}
