// AWS Lambda entry point for both API endpoints, deployed as a single
// function behind one Function URL so widget.js's existing
// base + 'api/chat' / base + 'api/send-lead' URL construction (see
// data-api-base in widget.js) keeps working unchanged — two separate
// Function URLs would live on two different hostnames, which the widget
// isn't built to address independently.
//
// Routes on the request path (Lambda Function URLs pass the full invoked
// path through as event.rawPath, same as a normal HTTP host) to the
// original Vercel handlers (api/chat.js, api/send-lead.js, copied here
// unmodified) via a shim that translates the Lambda event into the
// (req, res) shape those handlers expect.
import chatHandler from './api/chat.js';
import sendLeadHandler from './api/send-lead.js';

function toLambdaHandler(vercelHandler) {
  return async function (event) {
    const method =
      (event.requestContext && event.requestContext.http && event.requestContext.http.method) ||
      event.httpMethod ||
      'POST';

    let body = {};
    if (event.body) {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      try {
        body = JSON.parse(raw);
      } catch (e) {
        body = {};
      }
    }

    const req = { method, body };
    const headers = { 'Content-Type': 'application/json' };
    let statusCode = 200;
    let response = null;

    const res = {
      setHeader(key, value) {
        headers[key] = value;
        return res;
      },
      status(code) {
        statusCode = code;
        return res;
      },
      json(payload) {
        response = { statusCode, headers, body: JSON.stringify(payload) };
        return res;
      },
      end(payload) {
        response = { statusCode, headers, body: payload || '' };
        return res;
      },
    };

    await vercelHandler(req, res);
    return response || { statusCode: 500, headers, body: JSON.stringify({ error: 'No response produced' }) };
  };
}

const chatLambda = toLambdaHandler(chatHandler);
const sendLeadLambda = toLambdaHandler(sendLeadHandler);

export const handler = async (event) => {
  const path = (
    event.rawPath ||
    (event.requestContext && event.requestContext.http && event.requestContext.http.path) ||
    ''
  ).replace(/\/+$/, '');

  if (path.endsWith('/api/chat')) return chatLambda(event);
  if (path.endsWith('/api/send-lead')) return sendLeadLambda(event);

  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Not found', path }),
  };
};
