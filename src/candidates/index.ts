// Public API for the candidates module. Import shared candidate types/constants
// from here (`../candidates`) rather than reaching into `./dto/*` internals.
export { CANDIDATE_SOURCES } from './dto/create-candidate.dto';
export type { CandidateSource, CreateCandidateDto } from './dto/create-candidate.dto';
