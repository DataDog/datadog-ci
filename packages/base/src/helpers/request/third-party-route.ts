declare const thirdPartyRouteBrand: unique symbol

export type ThirdPartyRoute = string & {[thirdPartyRouteBrand]: true}

export const thirdPartyRoute = (url: string): ThirdPartyRoute => url as ThirdPartyRoute
