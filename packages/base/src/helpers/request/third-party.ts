declare const thirdPartyBrand: unique symbol

export type ThirdParty = string & {[thirdPartyBrand]: true}

export const thirdParty = (url: string): ThirdParty => url as ThirdParty
