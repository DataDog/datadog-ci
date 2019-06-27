// We have to keep this dependency-free so it can run in the CI with no installation.
import * as http from 'http';
import * as https from 'https';
import * as querystring from 'querystring';
import * as url from 'url';

export default ({ TOKEN, BASE_URL }: { TOKEN?: string, BASE_URL: string }) => ({
    method = 'GET',
    endpoint,
    qs,
    body,
    json = true,
}: { method: string, endpoint: string, qs: any, body: any, json: boolean }) => {
    // Compose the URI.
    const uri = /^https?:\/\//.test(endpoint)
        ? endpoint
        : `${BASE_URL}${endpoint}`;
    const qToken = TOKEN && { private_token: TOKEN };
    const { protocol, hostname, pathname, port } = url.parse(uri);
    let path = pathname;

    if (method === 'GET' || typeof qs !== 'undefined') {
        path += `?${querystring.stringify({ ...qToken, ...qs })}`;
    }

    return new Promise((resolve, reject) => {
        const protocolName = protocol!.replace(':', '');
        const requestMethod = protocolName === 'http' ? http.request : https.request;
        const req = requestMethod(
            { method, path, protocol, host: hostname, port },
            (res: any) => {
                if (res.statusCode !== 200) {
                    reject(`
Request Failed.
    Status Code: ${res.statusCode}
    Status Message: ${res.statusMessage}
`);
                    // Consume response data to free up memory
                    res.resume();
                    return;
                }

                res.setEncoding('utf8');
                let rawData = '';
                res.on('data', (chunk: string) => {
                    rawData += chunk;
                });

                res.on('end', () => {
                    try {
                        resolve(JSON.parse(rawData));
                    } catch (e) {
                        // If we were expecting JSON, we throw.
                        if (json) {
                            reject(e.message);
                        } else {
                            resolve(rawData);
                        }
                    }
                });
            }
        );

        req.on('error', reject);

        // Send.
        if (method === 'POST') {
            req.write(JSON.stringify({ ...qToken, ...body }));
        }
        req.end();
    });
};
