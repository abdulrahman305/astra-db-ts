import { uuidv4, uuidv7, UUID as UUIDv7 } from 'uuidv7';
import { ObjectId as MongoObjectId } from 'bson';

const uuidRegex = new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

export class UUID {
  public readonly version: number;
  private readonly _uuid: string;

  constructor(uuid: string, validate?: boolean) {
    if (validate !== false) {
      if (typeof <unknown>uuid !== 'string') {
        throw new Error('UUID must be a string');
      }

      if (uuid.length !== 36 || !uuidRegex.test(uuid)) {
        throw new Error('UUID must be a 36-character hex string');
      }
    }

    this._uuid = uuid.toLowerCase();
    this.version = parseInt(this._uuid[14], 16);
  }

  public equals(other: unknown): boolean {
    if (typeof other === 'string') {
      return this._uuid === other;
    }
    if (other instanceof UUID) {
      return this._uuid === other._uuid;
    }
    return false;
  }

  public getTimestamp(): Date | undefined {
    return timestampFromUUID(this);
  }

  public toString(): string {
    return this._uuid;
  }

  public static v4(): UUID {
    return new UUID(uuidv4(), false);
  }

  public static v7(): UUID {
    return new UUID(uuidv7(), false);
  }

  public inspect(): string {
    return `UUID("${this.toString()}")`;
  }
}

const objectIdRegex = new RegExp('^[0-9a-fA-F]{24}$');

export class ObjectId {
  private readonly _objectId: MongoObjectId;

  constructor(id?: string | MongoObjectId, validate = true) {
    if (validate && id) {
      if (typeof id === 'string') {
        if (id.length !== 24 || !objectIdRegex.test(id)) {
          throw new Error('ObjectId must be a 24-character hex string or a Mongo ObjectId');
        }
      } else if (!(<unknown>id instanceof MongoObjectId)) {
        throw new Error('ObjectId must be a 24-character hex string or a Mongo ObjectId');
      }
    }

    this._objectId = new MongoObjectId(id);
  }

  public equals(other: unknown): boolean {
    return this._objectId.equals((other && typeof other === 'object' && '_objectId' in other ? other._objectId : other) as any);
  }

  public getTimestamp(): Date {
    return this._objectId.getTimestamp();
  }

  public toString(): string {
    return this._objectId.toString();
  }

  public inspect(): string {
    return `ObjectId("${this.toString()}")`;
  }
}

/**
 * @internal
 */
export function replaceRawId(obj: any): any {
  if (!obj) {
    return obj;
  }

  if (obj.$uuid) {
    return new UUID(obj.$uuid, false);
  }

  if (obj.$objectId) {
    return new ObjectId(obj.$objectId, false);
  }

  if (obj._id && typeof obj._id === 'object') {
    obj._id = replaceRawId(obj._id);
  }

  return obj;
}

const timestampFromUUID = (uuid: UUID): Date | undefined => {
  if (uuid.version !== 7) {
    return undefined;
  }

  const timestampBytes = new Uint8Array(8);
  timestampBytes.set(new Uint8Array(UUIDv7.parse(uuid.toString()).bytes.buffer.slice(0, 6)), 2);
  const timestampMs = new DataView(timestampBytes.buffer).getBigUint64(0);

  return new Date(Number(timestampMs));
}
