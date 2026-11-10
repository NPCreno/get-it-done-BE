import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/** end >= start, comparing two Date-typed properties of the same object. */
export function IsAfterOrEqual(property: string, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isAfterOrEqual',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const other = (args.object as Record<string, unknown>)[args.constraints[0]];
          if (!(value instanceof Date) || !(other instanceof Date)) return true; // other validators report type errors
          return value.getTime() >= other.getTime();
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must not be before ${args.constraints[0]}`;
        },
      },
    });
  };
}
