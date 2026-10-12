import { IUploadedMulterFile } from '../interfaces/uploaded-multer-file.interface.js';

export class UploadFileDto {
  readonly file: IUploadedMulterFile;

  readonly folder: string;

  readonly name: string;
}
