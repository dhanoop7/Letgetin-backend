import { BaseRepository } from '../shared/base.repository.js';
import { IRecruiterOrganizationDocument, RecruiterOrganizationModel } from './recruiterOrg.model.js';

export class RecruiterOrgRepository extends BaseRepository<IRecruiterOrganizationDocument> {
  constructor() {
    super(RecruiterOrganizationModel);
  }

  async findByOwnerUserId(ownerUserId: string): Promise<IRecruiterOrganizationDocument | null> {
    return await this.findOne({ ownerUserId });
  }
}
