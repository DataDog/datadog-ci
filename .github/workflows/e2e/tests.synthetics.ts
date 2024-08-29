import type {v1} from '@datadog/datadog-api-client'

// const connectAsStandardUser: v1.SyntheticsStep = {
//   name: '[ci][standard] Connect as standard user.',
//   type: 'playSubTest',
//   params: {
//     playingTabId: -1,
//     subtestPublicId: 'nib-vri-fy7',
//   },
// }

const tests: v1.SyntheticsBrowserTest[] = []

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

tests.push({
  name: 'Shopist: Add an item to the cart',
  type: 'browser',
  message: 'Some message',
  config: {
    request: {
      method: 'GET', // XXX: why is this required?
      url: 'https://shopist.io',
    },
    assertions: [],
  },
  locations: ['aws:eu-central-1'],
  options: {
    // @ts-ignore
    device_ids: ['chrome.laptop_large'],
    // @ts-ignore
    tick_every: 60,
  },
  steps: [
    {
      name: 'Click on div "Shop now"',
      params: {
        element: {
          html:
            '<html style="display: initial;"><head></head>\n  <body style="display: revert;">\n    <div id="__nuxt"><!----><div id="__layout"><div><div data-v-f6da5874="" role="navigation" aria-label="main navigation"><div data-v-f6da5874="" class="navbar-large"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-large"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="navigation"><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/department/chairs" class="chairs"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Chairs <!----></div></div></a><a data-v-f6da5874="" href="/department/sofas" class="sofas"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Sofas <!----></div></div></a><a data-v-f6da5874="" href="/department/bedding" class="bedding"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Bedding <!----></div></div></a><a data-v-f6da5874="" href="/department/lighting" class="lighting"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Lighting <!----></div></div></a></div><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/profile" class="profile"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">My Profile <!----></div></div></a><a data-v-f6da5874="" href="/cart" class="cart"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Cart (1) <!----></div></div></a></div></div></div> <div data-v-f6da5874="" class="navbar-small"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-small"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="hamburger"><div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div></div></div> <div data-v-f6da5874="" class="navbar-small-cloak"><div data-v-f6da5874="" class="navbar-small-menu"><a data-v-f6da5874="" href="/department/chairs" class=""><div data-v-f6da5874="" class="menu-item-small">Chairs <!----></div></a><a data-v-f6da5874="" href="/department/sofas" class=""><div data-v-f6da5874="" class="menu-item-small">Sofas <!----></div></a><a data-v-f6da5874="" href="/department/bedding" class=""><div data-v-f6da5874="" class="menu-item-small">Bedding <!----></div></a><a data-v-f6da5874="" href="/department/lighting" class=""><div data-v-f6da5874="" class="menu-item-small">Lighting <!----></div></a><a data-v-f6da5874="" href="/profile" class=""><div data-v-f6da5874="" class="menu-item-small">My Profile <!----></div></a><a data-v-f6da5874="" href="/cart" class=""><div data-v-f6da5874="" class="menu-item-small">Cart (1) <!----></div></a></div></div></div> <section id="main"><div data-v-73bbe9de=""><section data-v-73bbe9de=""><div data-v-73bbe9de="" class="jumbotron jumbotron-large" style="opacity: 100;"><a data-v-73bbe9de="" href="/department/chairs"><div data-v-73bbe9de="" class="jumbotron-box"><div data-v-73bbe9de="">Shop the look</div> <div data-v-73bbe9de="">Your Guestroom Furniture on a Budget</div> <div data-v-73bbe9de="" data-datadog-interaction-target="">Shop now</div></div></a></div> <div data-v-73bbe9de="" class="jumbotron jumbotron-small"></div> <a data-v-73bbe9de="" href="/department/chairs"><div data-v-73bbe9de="" class="jumbotron-box jumbotron-box-small"><div data-v-73bbe9de="">Shop the look</div> <div data-v-73bbe9de="">Your Guestroom Furniture on a Budget</div> <div data-v-73bbe9de="">Shop now</div></div></a></section> <div data-v-73bbe9de="" class="departments"><a data-v-73bbe9de="" href="/department/chairs" class="department"><div data-v-73bbe9de=""><div data-v-73bbe9de="" class="serif">Chairs</div> <div data-v-73bbe9de="" class="caps">Shop now</div></div></a><a data-v-73bbe9de="" href="/department/sofas" class="department"><div data-v-73bbe9de=""><div data-v-73bbe9de="" class="serif">Sofas</div> <div data-v-73bbe9de="" class="caps">Shop now</div></div></a><a data-v-73bbe9de="" href="/department/bedding" class="department"><div data-v-73bbe9de=""><div data-v-73bbe9de="" class="serif">Bedding</div> <div data-v-73bbe9de="" class="caps">Shop now</div></div></a><a data-v-73bbe9de="" href="/department/lighting" class="department"><div data-v-73bbe9de=""><div data-v-73bbe9de="" class="serif">Lighting</div> <div data-v-73bbe9de="" class="caps">Shop now</div></div></a></div></div></section> <footer data-v-6e04645e="" class="footer"><div data-v-6e04645e="" class="departments"><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/chairs">Chairs</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/sofas">Sofas</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/bedding">Bedding</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/lighting">Lighting</a> <!----></div></div> <div data-v-6e04645e="" class="signup"><div data-v-6e04645e="" class="email"><a data-v-6e04645e="" href="/signup"><div data-v-6e04645e="" class="signup-button">\n          Sign Up for Shop.ist\n        </div></a></div></div> <!----> <div data-v-6e04645e="" class="brand"><img data-v-6e04645e="" src="" class="logo"> <div data-v-6e04645e="" class="shopist"><div data-v-6e04645e="">Hosted by</div> <img data-v-6e04645e="" src=""></div></div></footer> <div data-v-47302e4e="" class="modal-error"><div data-v-47302e4e="" class="modal-error-content"><div data-v-47302e4e="" class="modal-title">Something went wrong. Please try again.</div> <div data-v-47302e4e="" class="modal-button">Return to page</div></div></div> <div data-v-1afd6a43="" class="modal-sold-out"><div data-v-1afd6a43="" class="modal-sold-out-content"><div data-v-1afd6a43="" class="modal-title">Oops! This item is sold out.</div> <div data-v-1afd6a43="">It can\'t be added to your cart. We\'ll let you know when this item is back in stock.</div> <div data-v-1afd6a43="" class="modal-button">Continue shopping</div></div></div></div></div></div><script></script>\n  <script src="/_nuxt/aa168f5.js"></script><script src="/_nuxt/bc38f46.js"></script><script src="/_nuxt/3b08283.js"></script><script src="/_nuxt/7bc7dba.js"></script>\n\n</body></html>',
          targetOuterHTML: '<div data-v-73bbe9de="">Shop now</div>',
          url: 'https://shopist.io/',
        },
      },
      type: 'click',
      isCritical: true,
    },
    {
      name: 'Click on image "2.77cffca.jpg"',
      params: {
        element: {
          html:
            '<html style="display: initial;"><head></head>\n  <body style="display: revert;">\n    <div id="__nuxt"><!----><div id="__layout"><div><div data-v-f6da5874="" role="navigation" aria-label="main navigation"><div data-v-f6da5874="" class="navbar-large"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-large"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="navigation"><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/department/chairs" class="a-exact-active chairs"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Chairs <!----></div></div></a><a data-v-f6da5874="" href="/department/sofas" class="sofas"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Sofas <!----></div></div></a><a data-v-f6da5874="" href="/department/bedding" class="bedding"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Bedding <!----></div></div></a><a data-v-f6da5874="" href="/department/lighting" class="lighting"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Lighting <!----></div></div></a></div><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/profile" class="profile"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">My Profile <!----></div></div></a><a data-v-f6da5874="" href="/cart" class="cart"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Cart (1) <!----></div></div></a></div></div></div> <div data-v-f6da5874="" class="navbar-small"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-small"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="hamburger"><div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div></div></div> <div data-v-f6da5874="" class="navbar-small-cloak"><div data-v-f6da5874="" class="navbar-small-menu"><a data-v-f6da5874="" href="/department/chairs" class="a-exact-active"><div data-v-f6da5874="" class="menu-item-small">Chairs <!----></div></a><a data-v-f6da5874="" href="/department/sofas" class=""><div data-v-f6da5874="" class="menu-item-small">Sofas <!----></div></a><a data-v-f6da5874="" href="/department/bedding" class=""><div data-v-f6da5874="" class="menu-item-small">Bedding <!----></div></a><a data-v-f6da5874="" href="/department/lighting" class=""><div data-v-f6da5874="" class="menu-item-small">Lighting <!----></div></a><a data-v-f6da5874="" href="/profile" class=""><div data-v-f6da5874="" class="menu-item-small">My Profile <!----></div></a><a data-v-f6da5874="" href="/cart" class=""><div data-v-f6da5874="" class="menu-item-small">Cart (1) <!----></div></a></div></div></div> <div id="main"><div data-v-2d7131b0="" id="main"><div data-v-2d7131b0="" class="furniture">Furniture</div> <div data-v-2d7131b0="" class="products"><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><a data-v-1a022a0c="" href="/department/chairs/product/1"><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src=""> <div data-v-1a022a0c="" class="status">In stock</div></div></a></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">Wicker Chair</div> <div data-v-1a022a0c="" class="price">$250.00</div></div></div><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><a data-v-1a022a0c="" href="/department/chairs/product/2"><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src="" data-datadog-interaction-target=""> <div data-v-1a022a0c="" class="status">In stock</div></div></a></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">Black Shell Chair</div> <div data-v-1a022a0c="" class="price">$320.00</div></div></div><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><a data-v-1a022a0c="" href="/department/chairs/product/3"><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src=""> <div data-v-1a022a0c="" class="status">In stock</div></div></a></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">Wooden Stools</div> <div data-v-1a022a0c="" class="price">$210.00</div></div></div><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src=""> <div data-v-1a022a0c="" class="status status--red">Sold out</div></div></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">Upholstered White Chair</div> <div data-v-1a022a0c="" class="price">$210.00</div></div></div><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><a data-v-1a022a0c="" href="/department/chairs/product/5"><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src=""> <div data-v-1a022a0c="" class="status">In stock</div></div></a></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">White Shell Chair</div> <div data-v-1a022a0c="" class="price">$210.00</div></div></div><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><a data-v-1a022a0c="" href="/department/chairs/product/6"><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src=""> <div data-v-1a022a0c="" class="status">In stock</div></div></a></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">Modern Wooden Chair</div> <div data-v-1a022a0c="" class="price">$210.00</div></div></div><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><a data-v-1a022a0c="" href="/department/chairs/product/7"><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src=""> <div data-v-1a022a0c="" class="status">In stock</div></div></a></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">Tall Wooden Stool</div> <div data-v-1a022a0c="" class="price">$210.00</div></div></div><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><a data-v-1a022a0c="" href="/department/chairs/product/8"><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src=""> <div data-v-1a022a0c="" class="status">In stock</div></div></a></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">Plastic White Chair</div> <div data-v-1a022a0c="" class="price">$210.00</div></div></div><div data-v-1a022a0c="" data-v-2d7131b0="" class="product-card-container"><div data-v-1a022a0c=""><div data-v-1a022a0c="" class="product-card"><img data-v-1a022a0c="" src=""> <div data-v-1a022a0c="" class="status status--red">Sold out</div></div></div> <div data-v-1a022a0c="" class="description"><div data-v-1a022a0c="">Upholstered Black Barstool</div> <div data-v-1a022a0c="" class="price">$210.00</div></div></div></div></div></div> <footer data-v-6e04645e="" class="footer"><div data-v-6e04645e="" class="departments"><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/chairs">Chairs</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/sofas">Sofas</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/bedding">Bedding</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/lighting">Lighting</a> <!----></div></div> <div data-v-6e04645e="" class="signup"><div data-v-6e04645e="" class="email"><a data-v-6e04645e="" href="/signup"><div data-v-6e04645e="" class="signup-button">\n          Sign Up for Shop.ist\n        </div></a></div></div> <!----> <div data-v-6e04645e="" class="brand"><img data-v-6e04645e="" src="" class="logo"> <div data-v-6e04645e="" class="shopist"><div data-v-6e04645e="">Hosted by</div> <img data-v-6e04645e="" src=""></div></div></footer> <div data-v-1afd6a43="" class="modal-sold-out"><div data-v-1afd6a43="" class="modal-sold-out-content"><div data-v-1afd6a43="" class="modal-title">Oops! This item is sold out.</div> <div data-v-1afd6a43="">It can\'t be added to your cart. We\'ll let you know when this item is back in stock.</div> <div data-v-1afd6a43="" class="modal-button">Continue shopping</div></div></div></div></div></div><script></script>\n  <script src="/_nuxt/aa168f5.js"></script><script src="/_nuxt/bc38f46.js"></script><script src="/_nuxt/3b08283.js"></script><script src="/_nuxt/7bc7dba.js"></script>\n\n</body></html>',
          targetOuterHTML: '<img data-v-1a022a0c="" src="/_nuxt/img/2.77cffca.jpg">',
          url: 'https://shopist.io/department/chairs',
        },
      },
      type: 'click',
      isCritical: true,
    },
    {
      name: 'Click on div "Add to cart"',
      params: {
        element: {
          html:
            '<html style="display: initial;"><head></head>\n  <body style="display: revert;">\n    <div id="__nuxt"><!----><div id="__layout"><div><div data-v-f6da5874="" role="navigation" aria-label="main navigation"><div data-v-f6da5874="" class="navbar-large"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-large"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="navigation"><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/department/chairs" class="a-exact-active chairs"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Chairs <!----></div></div></a><a data-v-f6da5874="" href="/department/sofas" class="sofas"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Sofas <!----></div></div></a><a data-v-f6da5874="" href="/department/bedding" class="bedding"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Bedding <!----></div></div></a><a data-v-f6da5874="" href="/department/lighting" class="lighting"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Lighting <!----></div></div></a></div><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/profile" class="profile"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">My Profile <!----></div></div></a><a data-v-f6da5874="" href="/cart" class="cart"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Cart (1) <!----></div></div></a></div></div></div> <div data-v-f6da5874="" class="navbar-small"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-small"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="hamburger"><div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div></div></div> <div data-v-f6da5874="" class="navbar-small-cloak"><div data-v-f6da5874="" class="navbar-small-menu"><a data-v-f6da5874="" href="/department/chairs" class="a-exact-active"><div data-v-f6da5874="" class="menu-item-small">Chairs <!----></div></a><a data-v-f6da5874="" href="/department/sofas" class=""><div data-v-f6da5874="" class="menu-item-small">Sofas <!----></div></a><a data-v-f6da5874="" href="/department/bedding" class=""><div data-v-f6da5874="" class="menu-item-small">Bedding <!----></div></a><a data-v-f6da5874="" href="/department/lighting" class=""><div data-v-f6da5874="" class="menu-item-small">Lighting <!----></div></a><a data-v-f6da5874="" href="/profile" class=""><div data-v-f6da5874="" class="menu-item-small">My Profile <!----></div></a><a data-v-f6da5874="" href="/cart" class=""><div data-v-f6da5874="" class="menu-item-small">Cart (1) <!----></div></a></div></div></div> <section id="main"><section data-v-410250d0=""><div data-v-410250d0="" class="furniture">Furniture</div> <div data-v-410250d0="" class="item"><img data-v-cbb23b5e="" data-v-410250d0="" src="" class="product-card"> <div data-v-410250d0="" class="description"><div data-v-410250d0=""><div data-v-410250d0="">Black Shell Chair</div> <div data-v-410250d0="" class="price">$320.00</div> <div data-v-410250d0="" class="purchase-button" data-datadog-interaction-target="">Add to cart</div></div></div></div></section></section> <footer data-v-6e04645e="" class="footer"><div data-v-6e04645e="" class="departments"><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/chairs">Chairs</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/sofas">Sofas</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/bedding">Bedding</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/lighting">Lighting</a> <!----></div></div> <div data-v-6e04645e="" class="signup"><div data-v-6e04645e="" class="email"><a data-v-6e04645e="" href="/signup"><div data-v-6e04645e="" class="signup-button">\n          Sign Up for Shop.ist\n        </div></a></div></div> <!----> <div data-v-6e04645e="" class="brand"><img data-v-6e04645e="" src="" class="logo"> <div data-v-6e04645e="" class="shopist"><div data-v-6e04645e="">Hosted by</div> <img data-v-6e04645e="" src=""></div></div></footer> <div data-v-47302e4e="" class="modal-error"><div data-v-47302e4e="" class="modal-error-content"><div data-v-47302e4e="" class="modal-title">Something went wrong. Please try again.</div> <div data-v-47302e4e="" class="modal-button">Return to page</div></div></div> <div data-v-1afd6a43="" class="modal-sold-out"><div data-v-1afd6a43="" class="modal-sold-out-content"><div data-v-1afd6a43="" class="modal-title">Oops! This item is sold out.</div> <div data-v-1afd6a43="">It can\'t be added to your cart. We\'ll let you know when this item is back in stock.</div> <div data-v-1afd6a43="" class="modal-button">Continue shopping</div></div></div></div></div></div><script></script>\n  <script src="/_nuxt/aa168f5.js"></script><script src="/_nuxt/bc38f46.js"></script><script src="/_nuxt/3b08283.js"></script><script src="/_nuxt/7bc7dba.js"></script>\n\n</body></html>',
          targetOuterHTML: '<div data-v-410250d0="" class="purchase-button">Add to cart</div>',
          url: 'https://shopist.io/department/chairs/product/2',
        },
      },
      type: 'click',
      isCritical: true,
    },
    {
      name: 'Click on div "Cart (1)"',
      params: {
        element: {
          html:
            '<html style="display: initial;"><head></head>\n  <body style="display: revert;">\n    <div id="__nuxt"><!----><div id="__layout"><div><div data-v-f6da5874="" role="navigation" aria-label="main navigation"><div data-v-f6da5874="" class="navbar-large"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-large"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="navigation"><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/department/chairs" class="a-exact-active chairs"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Chairs <!----></div></div></a><a data-v-f6da5874="" href="/department/sofas" class="sofas"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Sofas <!----></div></div></a><a data-v-f6da5874="" href="/department/bedding" class="bedding"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Bedding <!----></div></div></a><a data-v-f6da5874="" href="/department/lighting" class="lighting"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Lighting <!----></div></div></a></div><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/profile" class="profile"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">My Profile <!----></div></div></a><a data-v-f6da5874="" href="/cart" class="cart"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large" data-datadog-interaction-target="">Cart (2) <!----></div></div></a></div></div></div> <div data-v-f6da5874="" class="navbar-small"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-small"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="hamburger"><div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div></div></div> <div data-v-f6da5874="" class="navbar-small-cloak"><div data-v-f6da5874="" class="navbar-small-menu"><a data-v-f6da5874="" href="/department/chairs" class="a-exact-active"><div data-v-f6da5874="" class="menu-item-small">Chairs <!----></div></a><a data-v-f6da5874="" href="/department/sofas" class=""><div data-v-f6da5874="" class="menu-item-small">Sofas <!----></div></a><a data-v-f6da5874="" href="/department/bedding" class=""><div data-v-f6da5874="" class="menu-item-small">Bedding <!----></div></a><a data-v-f6da5874="" href="/department/lighting" class=""><div data-v-f6da5874="" class="menu-item-small">Lighting <!----></div></a><a data-v-f6da5874="" href="/profile" class=""><div data-v-f6da5874="" class="menu-item-small">My Profile <!----></div></a><a data-v-f6da5874="" href="/cart" class=""><div data-v-f6da5874="" class="menu-item-small">Cart (2) <!----></div></a></div></div></div> <section id="main"><section data-v-410250d0=""><div data-v-410250d0="" class="furniture">Furniture</div> <div data-v-410250d0="" class="item"><img data-v-cbb23b5e="" data-v-410250d0="" src="" class="product-card"> <div data-v-410250d0="" class="description"><div data-v-410250d0=""><div data-v-410250d0="">Black Shell Chair</div> <div data-v-410250d0="" class="price">$320.00</div> <div data-v-410250d0="" class="purchase-button">Add to cart</div></div></div></div></section></section> <footer data-v-6e04645e="" class="footer"><div data-v-6e04645e="" class="departments"><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/chairs">Chairs</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/sofas">Sofas</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/bedding">Bedding</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/lighting">Lighting</a> <!----></div></div> <div data-v-6e04645e="" class="signup"><div data-v-6e04645e="" class="email"><a data-v-6e04645e="" href="/signup"><div data-v-6e04645e="" class="signup-button">\n          Sign Up for Shop.ist\n        </div></a></div></div> <!----> <div data-v-6e04645e="" class="brand"><img data-v-6e04645e="" src="" class="logo"> <div data-v-6e04645e="" class="shopist"><div data-v-6e04645e="">Hosted by</div> <img data-v-6e04645e="" src=""></div></div></footer> <div data-v-47302e4e="" class="modal-error"><div data-v-47302e4e="" class="modal-error-content"><div data-v-47302e4e="" class="modal-title">Something went wrong. Please try again.</div> <div data-v-47302e4e="" class="modal-button">Return to page</div></div></div> <div data-v-1afd6a43="" class="modal-sold-out"><div data-v-1afd6a43="" class="modal-sold-out-content"><div data-v-1afd6a43="" class="modal-title">Oops! This item is sold out.</div> <div data-v-1afd6a43="">It can\'t be added to your cart. We\'ll let you know when this item is back in stock.</div> <div data-v-1afd6a43="" class="modal-button">Continue shopping</div></div></div></div></div></div><script></script>\n  <script src="/_nuxt/aa168f5.js"></script><script src="/_nuxt/bc38f46.js"></script><script src="/_nuxt/3b08283.js"></script><script src="/_nuxt/7bc7dba.js"></script>\n\n</body></html>',
          targetOuterHTML: '<div data-v-f6da5874="" class="menu-item-large">Cart (2) <!----></div>',
          url: 'https://shopist.io/department/chairs/product/2',
        },
      },
      type: 'click',
      isCritical: true,
    },
    {
      name: 'Test div "Black Shell Chair ($320.00)" content',
      params: {
        element: {
          html:
            '<html style="display: initial;"><head></head>\n  <body style="display: revert;">\n    <div id="__nuxt"><!----><div id="__layout"><div><div data-v-f6da5874="" role="navigation" aria-label="main navigation"><div data-v-f6da5874="" class="navbar-large"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-large"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="navigation"><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/department/chairs" class="chairs"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Chairs <!----></div></div></a><a data-v-f6da5874="" href="/department/sofas" class="sofas"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Sofas <!----></div></div></a><a data-v-f6da5874="" href="/department/bedding" class="bedding"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Bedding <!----></div></div></a><a data-v-f6da5874="" href="/department/lighting" class="lighting"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Lighting <!----></div></div></a></div><div data-v-f6da5874="" class="navbar-section"><a data-v-f6da5874="" href="/profile" class="profile"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">My Profile <!----></div></div></a><a data-v-f6da5874="" href="/cart" class="a-exact-active cart"><div data-v-f6da5874="" class="menu-item-large-container"><div data-v-f6da5874="" class="menu-item-large">Cart (1) <!----></div></div></a></div></div></div> <div data-v-f6da5874="" class="navbar-small"><a data-v-f6da5874="" href="/"><div data-v-f6da5874="" class="brand-small"><img data-v-f6da5874="" src=""></div></a> <div data-v-f6da5874="" class="hamburger"><div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div> <div data-v-f6da5874="" class="hamburger-item"></div></div></div> <div data-v-f6da5874="" class="navbar-small-cloak"><div data-v-f6da5874="" class="navbar-small-menu"><a data-v-f6da5874="" href="/department/chairs" class=""><div data-v-f6da5874="" class="menu-item-small">Chairs <!----></div></a><a data-v-f6da5874="" href="/department/sofas" class=""><div data-v-f6da5874="" class="menu-item-small">Sofas <!----></div></a><a data-v-f6da5874="" href="/department/bedding" class=""><div data-v-f6da5874="" class="menu-item-small">Bedding <!----></div></a><a data-v-f6da5874="" href="/department/lighting" class=""><div data-v-f6da5874="" class="menu-item-small">Lighting <!----></div></a><a data-v-f6da5874="" href="/profile" class=""><div data-v-f6da5874="" class="menu-item-small">My Profile <!----></div></a><a data-v-f6da5874="" href="/cart" class="a-exact-active"><div data-v-f6da5874="" class="menu-item-small">Cart (1) <!----></div></a></div></div></div> <section id="main"><section data-v-d4665244="" class="cart"><div data-v-d4665244="" class="cart-count">Cart (1)</div> <div data-v-d4665244="" class="blocks"><div data-v-d4665244="" class="products"><div data-v-d4665244="" class="block-title">Your Items</div> <div data-v-d4665244="" class="block-separator"></div> <div data-v-d4665244=""><div data-v-d4665244=""><div data-v-d4665244="" class="product"><img data-v-d4665244="" src="" class="product-picture"> <div data-v-d4665244="" class="product-description"><div data-v-d4665244="" data-datadog-interaction-target="">\n                Black Shell Chair\n                <span data-v-d4665244="" class="price">($320.00)</span></div> <div data-v-d4665244="" class="product-bottom"><div data-v-d4665244="" class="product-counter"><div data-v-d4665244=""><div data-v-d4665244="" class="operator"><div data-v-d4665244="">-</div></div> <div data-v-d4665244="">1</div> <div data-v-d4665244="" class="operator"><div data-v-d4665244="">+</div></div></div> <div data-v-d4665244="" class="remove-button">Remove</div></div> <div data-v-d4665244="" class="product-price">$320.00</div></div></div></div></div></div></div> <div data-v-d4665244="" class="summary"><div data-v-d4665244="" class="block-title">Summary</div> <div data-v-d4665244="" class="block-separator"></div> <div data-v-d4665244="" class="lines"><div data-v-d4665244="" class="line"><div data-v-d4665244="">Order value</div> <div data-v-d4665244="">$320.00</div></div> <div data-v-d4665244="" class="line"><div data-v-d4665244="">Tax</div> <div data-v-d4665244="">25.60</div></div> <div data-v-d4665244="" class="line"><div data-v-d4665244="">Shipping</div> <div data-v-d4665244="">36.00</div></div> <div data-v-d4665244="" class="line"><div data-v-d4665244="">Processing Fees</div> <div data-v-d4665244="">0.00</div></div> <!----></div> <div data-v-d4665244="" class="block-separator"></div> <div data-v-d4665244="" class="line line-total"><div data-v-d4665244="">Total</div> <div data-v-d4665244="">381.60</div></div> <div data-v-d4665244="" class="discount"><input data-v-d4665244="" placeholder="Discount code" maxlength="15"> <div data-v-d4665244="">Apply</div></div> <div data-v-d4665244="" class="discount-toast"></div> <div data-v-d4665244="" class="checkout">Checkout</div></div></div></section></section> <footer data-v-6e04645e="" class="footer"><div data-v-6e04645e="" class="departments"><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/chairs">Chairs</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/sofas">Sofas</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/bedding">Bedding</a> <!----></div><div data-v-6e04645e="" class="caps"><a data-v-6e04645e="" href="/department/lighting">Lighting</a> <!----></div></div> <div data-v-6e04645e="" class="signup"><div data-v-6e04645e="" class="email"><a data-v-6e04645e="" href="/signup"><div data-v-6e04645e="" class="signup-button">\n          Sign Up for Shop.ist\n        </div></a></div></div> <!----> <div data-v-6e04645e="" class="brand"><img data-v-6e04645e="" src="" class="logo"> <div data-v-6e04645e="" class="shopist"><div data-v-6e04645e="">Hosted by</div> <img data-v-6e04645e="" src=""></div></div></footer> <div data-v-47302e4e="" class="modal-error"><div data-v-47302e4e="" class="modal-error-content"><div data-v-47302e4e="" class="modal-title">Something went wrong. Please try again.</div> <div data-v-47302e4e="" class="modal-button">Return to page</div></div></div> <div data-v-1afd6a43="" class="modal-sold-out"><div data-v-1afd6a43="" class="modal-sold-out-content"><div data-v-1afd6a43="" class="modal-title">Oops! This item is sold out.</div> <div data-v-1afd6a43="">It can\'t be added to your cart. We\'ll let you know when this item is back in stock.</div> <div data-v-1afd6a43="" class="modal-button">Continue shopping</div></div></div></div></div></div><script></script>\n  <script src="/_nuxt/aa168f5.js"></script><script src="/_nuxt/bc38f46.js"></script><script src="/_nuxt/3b08283.js"></script><script src="/_nuxt/7bc7dba.js"></script>\n\n</body></html>',
          targetOuterHTML:
            '<div data-v-d4665244="">\n                Black Shell Chair\n                <span data-v-d4665244="" class="price">($320.00)</span></div>',
          url: 'https://shopist.io/cart',
        },
        check: 'contains',
        value: 'Black Shell Chair ($320.00)',
      },
      type: 'assertElementContent',
      isCritical: true,
    },
  ],
})

tests.push({
  name: 'Shopist: Add an item to the cart (multilocators computed)',
  type: 'browser',
  message: 'Some message',
  config: {
    request: {
      method: 'GET', // XXX: why is this required?
      url: 'https://shopist.io',
    },
    assertions: [],
  },
  locations: ['aws:eu-central-1'],
  options: {
    // @ts-ignore
    device_ids: ['chrome.laptop_large'],
    // @ts-ignore
    tick_every: 60,
  },
  steps: [
    {
      name: 'Click on div "Shop now"',
      params: {
        element: {
          url: 'https://shopist.io/',
          multiLocator: {
            ab:
              '/*[local-name()="html"][1]/*[local-name()="body"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="section"][1]/*[local-name()="div"][1]/*[local-name()="section"][1]/*[local-name()="div"][1]/*[local-name()="a"][1]/*[local-name()="div"][1]/*[local-name()="div"][3]',
            at: '',
            cl:
              "/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" jumbotron-large \")]/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" jumbotron-box \")]/*[local-name()=\"div\"][3]",
            co:
              '[{"text":"shop now","textType":"directText"},{"relation":"PARENT OF","tagName":"A","text":"shop the look your guestroom furniture on a budget shop now","textType":"innerText"}]',
            ro: '//*[local-name()="div"][1]/*[local-name()="a"][1]/*[local-name()="div"][1]/*[3]',
            clt:
              "/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" jumbotron-large \")]/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" jumbotron-box \")]/descendant::*[text()[normalize-space(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞŸŽŠŒ', 'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿžšœ')) = \"shop now\"]]",
          },
          targetOuterHTML: '<div data-v-73bbe9de="">Shop now</div>',
        },
      },
      type: 'click',
      isCritical: true,
    },
    {
      name: 'Click on image "2.77cffca.jpg"',
      params: {
        element: {
          url: 'https://shopist.io/department/chairs',
          multiLocator: {
            ab:
              '/*[local-name()="html"][1]/*[local-name()="body"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][2]/*[local-name()="div"][1]/*[local-name()="div"][2]/*[local-name()="div"][2]/*[local-name()="div"][1]/*[local-name()="a"][1]/*[local-name()="div"][1]/*[local-name()="img"][1]',
            at: '/descendant::*[@href="/department/chairs/product/2"]/descendant::*[@src=""]',
            cl:
              '/descendant::*[contains(concat(\' \', normalize-space(@class), \' \'), " products ")]/*[local-name()="div"][2]/descendant::*[contains(concat(\' \', normalize-space(@class), \' \'), " product-card ")]/*[local-name()="img"][1]',
            co:
              '[{"relation":"BEFORE","tagName":"IMG","text":"in stock","textType":"innerText"},{"relation":"BEFORE","tagName":"DIV","text":"black shell chair $320.00","textType":"innerText"}]',
            ro: '//*[@href="/department/chairs/product/2"]/*/*[local-name()="img"]',
            clt:
              '/descendant::*[contains(concat(\' \', normalize-space(@class), \' \'), " products ")]/*[local-name()="div"][2]/descendant::*[contains(concat(\' \', normalize-space(@class), \' \'), " product-card ")]/*[local-name()="img"][1]',
          },
          targetOuterHTML: '<img data-v-1a022a0c="" src="/_nuxt/img/2.77cffca.jpg">',
        },
      },
      type: 'click',
      isCritical: true,
    },
    {
      name: 'Click on div "Add to cart"',
      params: {
        element: {
          url: 'https://shopist.io/department/chairs/product/2',
          multiLocator: {
            ab:
              '/*[local-name()="html"][1]/*[local-name()="body"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="section"][1]/*[local-name()="section"][1]/*[local-name()="div"][2]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][3]',
            at: '',
            cl: "/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" purchase-button \")]",
            co: '[{"text":"add to cart","textType":"directText"}]',
            ro:
              "//*[text()[normalize-space(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞŸŽŠŒ', 'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿžšœ')) = \"add to cart\"]]",
            clt: "/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" purchase-button \")]",
          },
          targetOuterHTML: '<div data-v-410250d0="" class="purchase-button">Add to cart</div>',
        },
      },
      type: 'click',
      isCritical: true,
    },
    {
      name: 'Click on div "Cart (1)"',
      params: {
        element: {
          url: 'https://shopist.io/department/chairs/product/2',
          multiLocator: {
            ab:
              '/*[local-name()="html"][1]/*[local-name()="body"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][2]/*[local-name()="a"][2]/*[local-name()="div"][1]/*[local-name()="div"][1]',
            at:
              '/descendant::*[@role="navigation"]/descendant::*[@href="/cart"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]',
            cl:
              "/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" cart \")]/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" menu-item-large \")]",
            co:
              '[{"text":"cart (2)","textType":"directText"},{"relation":"BEFORE","tagName":"A","text":"chairs sofas bedding lighting my profile cart (2) ","textType":"innerText"}]',
            ro:
              "//*[contains(concat(' ', normalize-space(@class), ' '), \" menu-item-large \") and text()[normalize-space(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞŸŽŠŒ', 'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿžšœ')) = \"cart (2)\"]]",
            clt:
              "/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" cart \")]/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" menu-item-large \")]",
          },
          targetOuterHTML: '<div data-v-f6da5874="" class="menu-item-large">Cart (2) <!----></div>',
        },
      },
      type: 'click',
      isCritical: true,
    },
    {
      name: 'Test div "Black Shell Chair ($320.00)" content',
      params: {
        check: 'contains',
        value: 'Black Shell Chair ($320.00)',
        element: {
          url: 'https://shopist.io/cart',
          multiLocator: {
            ab:
              '/*[local-name()="html"][1]/*[local-name()="body"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="section"][1]/*[local-name()="section"][1]/*[local-name()="div"][2]/*[local-name()="div"][1]/*[local-name()="div"][3]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]/*[local-name()="div"][1]',
            at: '',
            cl:
              '/descendant::*[contains(concat(\' \', normalize-space(@class), \' \'), " product-description ")]/*[local-name()="div"][1]',
            co: '[{"text":"black shell chair","textType":"directText"}]',
            ro:
              "//*[text()[normalize-space(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞŸŽŠŒ', 'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿžšœ')) = \"black shell chair\"]]",
            clt:
              "/descendant::*[contains(concat(' ', normalize-space(@class), ' '), \" product-description \")]/descendant::*[text()[normalize-space(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞŸŽŠŒ', 'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿžšœ')) = \"black shell chair\"]]",
          },
          targetOuterHTML:
            '<div data-v-d4665244="">\n                Black Shell Chair\n                <span data-v-d4665244="" class="price">($320.00)</span></div>',
        },
      },
      type: 'assertElementContent',
      isCritical: true,
    },
  ],
})

export default tests
