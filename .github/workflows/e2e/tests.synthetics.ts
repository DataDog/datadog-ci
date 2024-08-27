import type {v1} from '@datadog/datadog-api-client'

// const connectAsStandardUser: v1.SyntheticsStep = {
//   name: '[ci][standard] Connect as standard user.',
//   type: 'playSubTest',
//   params: {
//     playingTabId: -1,
//     subtestPublicId: 'nib-vri-fy7',
//   },
// }

// const tests: v1.SyntheticsBrowserTest[] = []

// tests.push({
//   name: "View Traces on Dashboard: 'http.status_code' to '@http.status_code'",
//   type: 'browser',
//   message: 'Some message',
//   config: {
//     request: {
//       method: 'GET', // XXX: why is this required?
//       url: 'https://synthetics-ci.datadoghq.com/apm/home',
//     },
//     assertions: [],
//   },
//   locations: ['aws:eu-central-1'],
//   options: {
//     // @ts-ignore
//     device_ids: ['chrome.laptop_large'],
//     // @ts-ignore
//     tick_every: 60,
//   },
//   steps: [
//     connectAsStandardUser,
//     {
//       name: 'Test that the attribute is in the header',
//       type: 'assertElementContent',
//       params: {
//         check: 'contains',
//         value: '@http.status_code',
//         element: {
//           targetOuterHTML:
//             '<code class="druids_typography_code__code druids_typography_code__code--is-string">env:staging AND service:synthtracer AND resource_name:inverse AND @http.status_code:200 operation_name:synthtracer</c',
//         },
//       },
//     },
//   ],
// })

// tests.push({
//   name: 'Home to App Analytics',
//   type: 'browser',
//   message: 'Some message',
//   config: {
//     request: {
//       method: 'GET', // XXX: why is this required?
//       url: 'https://synthetics-ci.datadoghq.com/apm/home',
//     },
//     assertions: [],
//   },
//   locations: ['aws:eu-central-1'],
//   options: {
//     // @ts-ignore
//     device_ids: ['chrome.laptop_large'],
//     // @ts-ignore
//     tick_every: 60,
//   },
//   steps: [
//     connectAsStandardUser,
//     {
//       type: 'click',
//       name: 'Click on link "Traces"',
//       params: {
//         element: {
//           targetOuterHTML: '<span class="druids_layout_flex-item">Traces</span>',
//         },
//       },
//     },
//     {
//       type: 'assertCurrentUrl',
//       name: 'Should navigate to the Traces page',
//       params: {
//         check: 'contains',
//         value: '{{ BASE_URL_WITHOUT_SUBDOMAIN }}/apm/traces',
//       },
//     },
//   ],
// })

const tests: v1.SyntheticsAPITest[] = []

tests.push({
  name: 'Second ephemeral api test',
  type: 'api',
  subtype: 'http',
  message: '',
  tags: [],
  locations: ['aws:eu-central-1'],
  config: {
    assertions: [],
    request: {
      method: 'GET',
      url: 'https://google.com',
      timeout: 60,
    },
  },
  options: {
    // @ts-ignore
    tick_every: 60,
    httpVersion: 'any',
  },
})

export default tests
