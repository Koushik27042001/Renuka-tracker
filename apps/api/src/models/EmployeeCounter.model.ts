import { Schema, type Connection } from 'mongoose';

const schema = new Schema(
  {
    _id: { type: String, required: true },
    sequence: { type: Number, required: true },
  },
  { collection: 'employee_counters', versionKey: false },
);

export function employeeCounterModel(connection: Connection) {
  return connection.model('EmployeeCounter', schema);
}
