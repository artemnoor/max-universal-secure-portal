export type PrincipalId = number;
export type PortalRole = 'user' | 'admin';

export type PortalPrincipal = Readonly<{
  userId: PrincipalId;
  role: PortalRole;
  chatId?: number;
}>;

export type RequestContext = Readonly<{
  requestId: string;
  source: 'max' | 'miniapp' | 'internal';
  principal?: PortalPrincipal;
}>;
