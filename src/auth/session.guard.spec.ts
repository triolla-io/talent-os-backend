import { SessionGuard } from './session.guard';
import { JwtService } from './jwt.service';

describe('SessionGuard', () => {
  let guard: SessionGuard;
  let jwtService: Partial<JwtService>;

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    guard = new SessionGuard(jwtService as JwtService);
  });

  it.todo('returns true when talent_os_session cookie is valid JWT');
  it.todo('throws UnauthorizedException when no cookie present');
  it.todo('throws UnauthorizedException when JWT is expired');
  it.todo('attaches decoded payload to request.session');
});
